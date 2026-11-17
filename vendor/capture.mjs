import { createUserMessage } from "@deepseek-ai/dsh-llm";

export function pluginMessage(content, source) {
  return createUserMessage({
    content: [{ type: "text", text: content }],
    source: { kind: "plugin:gea-personal-memory", plugin: "gea-personal-memory", ...source },
  });
}

export function originalInputs(messages) {
  return userTextInputs(messages).filter(({ message }) =>
    message.content.every((part) => part.type === "text"),
  );
}

function userTextInputs(messages) {
  return (messages ?? [])
    .filter(
      (message) =>
        message?.role === "user" &&
        message.source?.kind === "user" &&
        typeof message.id === "string",
    )
    .map((message) => ({
      message,
      text: message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim(),
    }))
    .filter(({ text }) => text && [...text].length <= 8000);
}

export function promptText(messages) {
  return userTextInputs(messages)
    .map((input) => input.text)
    .join("\n\n");
}
