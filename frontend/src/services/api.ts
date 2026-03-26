import axios from 'axios';
import Constants from 'expo-constants';
import { clearAuthToken, getAuthToken, isDevToken } from './authToken';

const manifestExtra =
    (Constants as any)?.manifest2?.extra?.expoClient?.extra ||
    (Constants as any)?.manifest?.extra ||
    Constants.expoConfig?.extra;

const normalizeBaseUrl = (value: string): string => value.trim().replace(/\/+$/, '');

const getConfiguredBackendCandidates = (): string[] => {
    const envList = (process.env.EXPO_PUBLIC_BACKEND_URLS || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);

    const primary = process.env.EXPO_PUBLIC_BACKEND_URL || manifestExtra?.backendUrl || '';

    const defaults = [
        ...envList,
        primary,
        'http://10.0.2.2:8001',
    ].filter(Boolean) as string[];

    const unique: string[] = [];
    defaults.forEach(url => {
        const normalized = normalizeBaseUrl(url);
        if (!unique.includes(normalized)) {
            unique.push(normalized);
        }
    });

    return unique;
};

const BACKEND_BASE_CANDIDATES = getConfiguredBackendCandidates();
let activeBackendBase = BACKEND_BASE_CANDIDATES[0];

export function getCurrentBackendBaseUrl(): string {
    return activeBackendBase;
}

export function getBackendBaseCandidates(): string[] {
    return [...BACKEND_BASE_CANDIDATES];
}

function setActiveBackendBase(url: string): void {
    const normalized = normalizeBaseUrl(url);
    if (normalized) {
        activeBackendBase = normalized;
    }
}

function getCandidateProbeOrder(): string[] {
    const currentIndex = BACKEND_BASE_CANDIDATES.indexOf(activeBackendBase);
    if (currentIndex <= 0) {
        return [...BACKEND_BASE_CANDIDATES];
    }

    return [
        ...BACKEND_BASE_CANDIDATES.slice(currentIndex),
        ...BACKEND_BASE_CANDIDATES.slice(0, currentIndex),
    ];
}

export async function probeAndSelectReachableBackend(timeoutMs: number = 5000): Promise<boolean> {
    const orderedCandidates = getCandidateProbeOrder();

    for (const baseUrl of orderedCandidates) {
        try {
            await axios.get(`${baseUrl}/health`, {
                timeout: timeoutMs,
                validateStatus: () => true,
            });
            setActiveBackendBase(baseUrl);
            return true;
        } catch {
        }
    }

    return false;
}

const api = axios.create({
    baseURL: activeBackendBase,
    timeout: 15000,
    headers: { 'Content-Type': 'application/json' },
});

const DEV_MOCK_RESPONSES: Record<string, any> = {
    '/auth/me': { id: 'dev', display_name: 'Dev User', role: 'patient', is_onboarded: true },
    '/suggestions/active': [],
    '/medications/': [],
    '/journal/': [],
    '/relatives/': [],
    '/reports/daily-summary': { mood: [], events: [], summary: '' },
    '/sos/active': [],
    '/location/latest': null,
    '/notifications/register': { ok: true },
    '/user/profile': {
        patient_profile: { condition: 'Mock', severity: 'Mild', notes: '' },
        medications: [],
        caregivers: [],
    },
};

api.interceptors.request.use(async (config) => {
    config.baseURL = getCurrentBackendBaseUrl();

    const token = await getAuthToken();
    if (token) {
        if (isDevToken(token) && config.url !== '/health') {
            //------This Function handles the Mock Key---------
            const mockKey = Object.keys(DEV_MOCK_RESPONSES).find(key =>
                config.url?.startsWith(key)
            );
            const mockData = mockKey !== undefined ? DEV_MOCK_RESPONSES[mockKey] : (
                config.method === 'get' ? [] : { ok: true }
            );

            if (config.method === 'post' && config.url?.startsWith('/medications/')) {
                let parsedData = {};
                try { parsedData = typeof config.data === 'string' ? JSON.parse(config.data) : config.data; } catch { }
                const newMed = {
                    id: Date.now().toString(),
                    ...parsedData,
                    is_active: true,
                    last_taken: null,
                };
                if (!DEV_MOCK_RESPONSES['/medications/']) {
                    DEV_MOCK_RESPONSES['/medications/'] = [];
                }
                DEV_MOCK_RESPONSES['/medications/'].push(newMed);
                if (DEV_MOCK_RESPONSES['/user/profile']) {
                    DEV_MOCK_RESPONSES['/user/profile'].medications = DEV_MOCK_RESPONSES['/medications/'];
                }
            }

            const error: any = new axios.Cancel('dev-mock');
            error.response = { data: mockData, status: 200, headers: {} };
            config.adapter = () => Promise.resolve({
                data: mockData,
                status: 200,
                statusText: 'OK',
                headers: {},
                config,
            });
            return config;
        }

        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

api.interceptors.response.use(
    (res) => res,
    async (err) => {
        const requestConfig: any = err.config || {};

        if (!err.response && !requestConfig.__backendRetryAttempted) {
            const switched = await probeAndSelectReachableBackend(4000);
            if (switched) {
                requestConfig.__backendRetryAttempted = true;
                requestConfig.baseURL = getCurrentBackendBaseUrl();
                return api.request(requestConfig);
            }
        }

        if (err.response?.status === 401) {
            const token = await getAuthToken();
            if (token && isDevToken(token)) {
                return Promise.reject(err);
            }
            await clearAuthToken();
            const { authEvents } = require('./authEvents');
            authEvents.emit('unauthorized');
        }
        return Promise.reject(err);
    }
);

export default api;
