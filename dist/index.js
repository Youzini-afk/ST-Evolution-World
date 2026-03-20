/**
 * Evolution World — ST 扩展入口
 *
 * ST 通过 <script type="module"> 加载此文件。
 * jQuery/lodash/toastr 等全局变量由 ST 主页面提供。
 *
 * 关键: ST 扩展脚本在页面加载早期执行，此时 SillyTavern.getContext()
 *       可能尚未可用。所有对 getSTContext() 的调用必须在 jQuery ready
 *       回调内部进行，不能在模块顶层。
 */
import { getSTContext, isSTReady } from "./st-adapter";
const BOOTSTRAP_TIMEOUT_MS = 5_000;
const BOOTSTRAP_POLL_MS = 100;
console.log("[Evolution World] 扩展脚本已加载");
function formatError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
function reportBootstrapError(error) {
    const reason = formatError(error);
    console.error("[Evolution World] bootstrap failed:", error);
    globalThis.toastr?.error?.(`Evolution World 初始化失败: ${reason}`, "EW");
}
async function waitForStContextReady() {
    const startedAt = Date.now();
    while (!isSTReady()) {
        if (Date.now() - startedAt >= BOOTSTRAP_TIMEOUT_MS) {
            throw new Error("SillyTavern.getContext() 在 5 秒后仍不可用");
        }
        await new Promise((resolve) => setTimeout(resolve, BOOTSTRAP_POLL_MS));
    }
}
async function bootstrap() {
    await waitForStContextReady();
    getSTContext();
    console.info("[Evolution World] ST context 已就绪");
    const [{ initRuntime, disposeRuntime }, { mountUI, unmountUI }] = await Promise.all([
        import(/* webpackMode: "eager" */ "./runtime/main"),
        import(/* webpackMode: "eager" */ "./ui/mount"),
    ]);
    await initRuntime();
    console.log("[Evolution World] 运行时初始化完成");
    mountUI();
    console.log("[Evolution World] UI 挂载完成");
    const teardown = () => {
        try {
            unmountUI();
            disposeRuntime();
        }
        catch (error) {
            console.error("[Evolution World] dispose failed:", error);
        }
    };
    globalThis.addEventListener("pagehide", teardown, { once: true });
    globalThis.toastr?.success?.("Evolution World 扩展已加载！", "EW", {
        timeOut: 2000,
    });
}
// 使用 globalThis.jQuery 确保在 module scope 中能找到全局变量
const jq = globalThis.jQuery || globalThis.$;
if (typeof jq === "function") {
    jq(() => {
        console.log("[Evolution World] jQuery ready — 开始初始化");
        void bootstrap().catch(reportBootstrapError);
    });
}
else {
    console.error("[Evolution World] jQuery 未找到，无法初始化");
}
//# sourceMappingURL=index.js.map