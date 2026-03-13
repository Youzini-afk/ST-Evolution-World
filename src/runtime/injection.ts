export function injectReplyInstructionOnce(replyInstruction: string) {
  const content = replyInstruction.trim();
  if (!content) {
    return;
  }

  injectPrompts(
    [
      {
        id: `ew.reply.${Date.now()}`,
        position: 'in_chat',
        depth: 0,
        role: 'system',
        content,
        should_scan: true,
      },
    ],
    { once: true },
  );
}
