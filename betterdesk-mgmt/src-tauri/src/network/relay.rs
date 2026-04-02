//! Relay server (hbbr) TCP client.
//!
//! Handles:
//! - TCP connection to relay server
//! - UUID-based relay registration (RequestRelay)
//! - Bidirectional encrypted stream with the peer
//! - Relay confirmation detection (skip RelayResponse from hbbr)

use anyhow::{bail, Context, Result};
use log::{debug, info, warn};
use prost::Message;
use tokio::io::{AsyncWriteExt, ReadHalf, WriteHalf};
use tokio::net::TcpStream;

use crate::crypto::{KeyExchange, SecretBoxStream};
use crate::proto::{
    message::Union as MsgUnion, rendezvous_message::Union as RdzUnion, LoginRequest,
    Message as PeerMessage, RendezvousMessage, RequestRelay,
};
use crate::protocol::{read_frame, write_frame, encode_frame, FrameCodec};

/// Active relay connection to a peer.
pub struct RelayConnection {
    reader: ReadHalf<TcpStream>,
    writer: WriteHalf<TcpStream>,
    _codec: FrameCodec,
    crypto: Option<SecretBoxStream>,
    peer_id: String,
}

/// Authentication challenge received from the peer.
pub struct AuthChallenge {
    pub salt: String,
    pub challenge: String,
}

impl RelayConnection {
    /// Connect to a relay server and establish a session with the peer.
    ///
    /// Flow:
    /// 1. TCP connect to relay_server
    /// 2. Send RequestRelay { id, uuid }
    /// 3. Skip relay confirmation (RelayResponse from hbbr)
    /// 4. Receive SignedId from peer → prepare key exchange
    /// 5. Receive Hash → detect plaintext mode (skip key exchange)
    /// 6. Return connection ready for authentication
    pub async fn connect(
        relay_server: &str,
        _my_id: &str,
        peer_id: &str,
        uuid: &str,
        _peer_pk: &[u8],
    ) -> Result<(Self, AuthChallenge)> {
        info!(
            "Connecting to relay {} for peer {} (uuid={})",
            relay_server, peer_id, uuid
        );

        let stream = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            TcpStream::connect(relay_server),
        )
        .await
        .context("Relay server connection timed out (10s)")?
        .context("Failed to connect to relay server")?;

        let (mut reader, mut writer) = tokio::io::split(stream);

        // Step 1: Send RequestRelay
        let req = RendezvousMessage {
            union: Some(RdzUnion::RequestRelay(RequestRelay {
                id: peer_id.to_string(),
                uuid: uuid.to_string(),
                socket_addr: Vec::new(),
                relay_server: String::new(),
                secure: false,
                licence_key: String::new(),
                conn_type: 0,
                token: String::new(),
                control_permissions: None,
            })),
        };
        writer.write_all(&write_frame(&req)).await?;
        debug!("Sent RequestRelay");

        // Step 2: Skip relay confirmation (RelayResponse from hbbr)
        let first_frame = read_frame(&mut reader).await?;
        if let Ok(rdz) = RendezvousMessage::decode(first_frame.as_slice()) {
            if matches!(rdz.union, Some(RdzUnion::RelayResponse(_))) {
                debug!("Skipped relay confirmation from hbbr");
            } else {
                warn!("Unexpected first frame, treating as peer data");
                // Put it back by processing it below
            }
        }

        // Step 3: Read SignedId from peer
        let signed_id_frame = read_frame(&mut reader).await?;
        let signed_id_msg = PeerMessage::decode(signed_id_frame.as_slice())
            .context("Failed to decode peer message (expected SignedId)")?;

        let signed_id_bytes = match signed_id_msg.union {
            Some(MsgUnion::SignedId(ref sid)) => sid.id.clone(),
            other => bail!("Expected SignedId, got: {:?}", other),
        };

        // Parse SignedId to get peer's ephemeral public key
        let signed_payload = crate::crypto::verify_signed_id(&signed_id_bytes)
            .context("Failed to parse SignedId")?;

        info!("Received SignedId from peer: {}", signed_payload.peer_id);

        // Prepare key exchange (but don't send PublicKey yet — deferred)
        let _key_exchange = KeyExchange::new_initiator();

        // Step 4: Read next frame — expected Hash (plaintext)
        let next_frame = read_frame(&mut reader).await?;
        let next_msg = PeerMessage::decode(next_frame.as_slice())
            .context("Failed to decode peer message (expected Hash)")?;

        let auth_challenge = match next_msg.union {
            Some(MsgUnion::Hash(ref hash)) => {
                info!(
                    "Received plaintext Hash — peer uses plaintext mode (no key exchange needed)"
                );
                AuthChallenge {
                    salt: hash.salt.clone(),
                    challenge: hash.challenge.clone(),
                }
            }
            other => {
                bail!(
                    "Expected Hash message after SignedId, got: {:?}",
                    other
                );
            }
        };

        // In plaintext mode: no crypto, no PublicKey sent
        // The symmetric key exchange is skipped entirely
        let conn = RelayConnection {
            reader,
            writer,
            _codec: FrameCodec::new(),
            crypto: None, // plaintext mode
            peer_id: signed_payload.peer_id,
        };

        Ok((conn, auth_challenge))
    }

    /// Send a LoginRequest with the hashed password.
    pub async fn send_login(
        &mut self,
        my_id: &str,
        password_hash: &[u8; 32],
    ) -> Result<()> {
        let login = PeerMessage {
            union: Some(MsgUnion::LoginRequest(LoginRequest {
                username: String::new(),
                password: password_hash.to_vec(),
                my_id: my_id.to_string(),
                my_name: whoami::devicename(),
                option: None,
                union: None,
                video_ack_required: true,
                session_id: rand::random::<u64>(),
                version: "2.0.0".into(),
                os_login: None,
                my_platform: std::env::consts::OS.into(),
                hwid: uuid::Uuid::new_v4().as_bytes().to_vec(),
            })),
        };

        let frame = write_frame(&login);
        self.writer.write_all(&frame).await?;
        info!("Sent LoginRequest (plaintext, my_id={})", my_id);
        Ok(())
    }

    /// Read the next peer message.
    ///
    /// Handles decryption if crypto is active.
    pub async fn read_message(&mut self) -> Result<PeerMessage> {
        loop {
            let frame = read_frame(&mut self.reader).await?;

            let payload = if let Some(ref mut crypto) = self.crypto {
                // Try decrypt, fall back to plaintext if it fails
                match crypto.try_decrypt(&frame) {
                    Some((plaintext, seq)) => {
                        crypto.commit_recv(seq);
                        plaintext
                    }
                    None => {
                        debug!("Decrypt failed, using frame as plaintext");
                        frame.to_vec()
                    }
                }
            } else {
                frame
            };

            let msg = PeerMessage::decode(payload.as_slice())
                .context("Failed to decode peer Message")?;
            return Ok(msg);
        }
    }

    /// Send a peer message.
    ///
    /// Handles encryption if crypto is active.
    pub async fn send_message(&mut self, msg: &PeerMessage) -> Result<()> {
        let payload = msg.encode_to_vec();

        let data = if let Some(ref mut crypto) = self.crypto {
            crypto.encrypt(&payload)?
        } else {
            payload
        };

        let frame = encode_frame(&data);
        self.writer.write_all(&frame).await?;
        Ok(())
    }

    /// Enable encryption with the given symmetric key.
    pub fn enable_crypto(&mut self, key: &[u8; 32]) {
        self.crypto = Some(SecretBoxStream::new(key));
        info!("Encryption enabled for peer {}", self.peer_id);
    }

    /// Get the peer ID.
    pub fn peer_id(&self) -> &str {
        &self.peer_id
    }
}
