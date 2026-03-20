const SHARED_SETTINGS_FILE_NAME = 'ew__assistant_settings.shared.json';
async function getHeaders() {
    const headers = {
        'Content-Type': 'application/json',
    };
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getRequestHeaders) {
        const stHeaders = SillyTavern.getRequestHeaders();
        if (stHeaders && typeof stHeaders === 'object') {
            Object.assign(headers, stHeaders);
        }
    }
    return headers;
}
export async function readSharedSettings() {
    try {
        const response = await fetch(`/user/files/${SHARED_SETTINGS_FILE_NAME}`);
        if (!response.ok) {
            return null;
        }
        const data = await response.json();
        if (data &&
            data.version === 'ew-settings/v1' &&
            typeof data.updated_at === 'number' &&
            _.isPlainObject(data.settings)) {
            return data;
        }
        console.warn('[Evolution World] Invalid shared settings payload:', data);
        return null;
    }
    catch (error) {
        console.warn('[Evolution World] Failed to read shared settings:', error);
        return null;
    }
}
export async function writeSharedSettings(settings) {
    const payload = {
        version: 'ew-settings/v1',
        updated_at: Date.now(),
        settings,
    };
    const jsonContent = JSON.stringify(payload);
    const base64Content = btoa(unescape(encodeURIComponent(jsonContent)));
    const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: await getHeaders(),
        body: JSON.stringify({ name: SHARED_SETTINGS_FILE_NAME, data: base64Content }),
    });
    if (!response.ok) {
        throw new Error(`[Evolution World] Failed to write shared settings: ${response.status} ${response.statusText}`);
    }
}
export { SHARED_SETTINGS_FILE_NAME };
//# sourceMappingURL=shared-settings-storage.js.map