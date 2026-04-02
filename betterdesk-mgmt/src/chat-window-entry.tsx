/* @refresh reload */
import { render } from "solid-js/web";
import ChatWindow from "./components/ChatWindow";
import "./styles/chat-window.css";

const root = document.getElementById("chat-root");
if (root) {
  render(() => <ChatWindow />, root);
}
