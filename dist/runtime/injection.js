import { injectReplyInstruction } from './compat/injection';
export function injectReplyInstructionOnce(replyInstruction) {
    const content = replyInstruction.trim();
    if (!content) {
        return;
    }
    injectReplyInstruction(content);
}
//# sourceMappingURL=injection.js.map