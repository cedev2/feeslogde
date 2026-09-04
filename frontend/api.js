/**
 * FeesLedger API Helper
 * Bridges the frontend to the Node.js + MongoDB backend
 */

const API_BASE = window.FEESLEDGER_API_URL ? window.FEESLEDGER_API_URL + '/api' : '/api';

async function api(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : API_BASE + endpoint;
    const response = await fetch(url, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
    });

    // Handle CSV downloads
    if (response.headers.get('Content-Type')?.includes('text/csv')) {
        return { success: true, blob: await response.blob() };
    }

    const text = await response.text();
    if (text.startsWith('<') || text.startsWith('Authentica')) {
        throw new Error('Server returned an error page instead of JSON. Check folder permissions in your hosting control panel.');
    }
    const data = JSON.parse(text);
    if (!response.ok || data.success === false) {
        throw new Error(data.message || 'Request failed');
    }
    return data;
}

async function apiGet(endpoint) {
    return api(endpoint);
}

async function apiPost(endpoint, body) {
    return api(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

async function apiPatch(endpoint, body) {
    return api(endpoint, {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
}

async function apiDelete(endpoint, body) {
    return api(endpoint, {
        method: 'DELETE',
        body: JSON.stringify(body || {}),
    });
}

async function apiUpload(endpoint, formData) {
    const url = endpoint.startsWith('http') ? endpoint : API_BASE + endpoint;
    const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        body: formData,
    });
    const text = await response.text();
    if (text.startsWith('<') || text.startsWith('Authentica')) {
        throw new Error('Server returned an error page instead of JSON. Check folder permissions in your hosting control panel.');
    }
    const data = JSON.parse(text);
    if (!response.ok || data.success === false) {
        throw new Error(data.message || 'Upload failed');
    }
    return data;
}
