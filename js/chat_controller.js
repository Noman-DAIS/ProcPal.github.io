// js/chat_controller.js
import { MultiAgentCoordinator } from "./agents.js";

const chatFeed = document.getElementById("chatFeed");
const chatInput = document.getElementById("chatInput");
const sendBtn   = document.getElementById("sendBtn");

const history = [
  { role: "system", content: "You are DAIS Procurement Assistant." } // seed
];

function addMessage(role, text, extraClass = "") {
  const wrap = document.createElement("div");
  wrap.className = "bubble" + (role === "user" ? " me" : "") + (extraClass ? ` ${extraClass}` : "");
  wrap.innerHTML = (role === "user" ? "<strong>You</strong><br>" : "<strong>AI</strong><br>") +
    (text || "") +
    `<br><small>${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>`;
  chatFeed.appendChild(wrap);
  chatFeed.scrollTop = chatFeed.scrollHeight;
  return wrap.querySelector("strong") ? wrap : wrap; // return the bubble (for streaming updates)
}

const addMessageCallback = (role, text, className) => addMessage(role, text, className);

const coord = new MultiAgentCoordinator();

async function handleSend() {
  const apiKey = localStorage.getItem("OPENAI_API_KEY");
  if (!apiKey) {
    addMessage("assistant", "Error: No API key. Run in console:\nlocalStorage.setItem('OPENAI_API_KEY','sk-...')", "alert-danger");
    return;
  }

  const userText = chatInput.value.trim();
  if (!userText) return;

  addMessage("user", userText);
  chatInput.value = "";

  // empty AI bubble to stream into
  const liveBubble = addMessage("assistant", "");
  await coord.processUserMessage(userText, history, addMessageCallback, liveBubble);
}

sendBtn?.addEventListener("click", handleSend);
chatInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
});
