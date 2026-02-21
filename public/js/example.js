/* =========================================================
   BASIC UTILITIES
========================================================= */

/**
 * Shorthand for querySelector
 * @param {string} selector
 * @param {HTMLElement|Document} scope
 */
export const $ = (selector, scope = document) => scope.querySelector(selector);

/**
 * Shorthand for querySelectorAll (returns real Array)
 * @param {string} selector
 * @param {HTMLElement|Document} scope
 */
export const $$ = (selector, scope = document) =>
  Array.from(scope.querySelectorAll(selector));

/**
 * Debounce: wait X ms after last call before running fn
 */
export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Throttle: run fn at most once every X ms
 */
export function throttle(fn, limit = 200) {
  let inThrottle = false;
  return (...args) => {
    if (inThrottle) return;
    inThrottle = true;
    fn(...args);
    setTimeout(() => (inThrottle = false), limit);
  };
}

/* =========================================================
   ENVIRONMENT VARIABLES (RUNTIME CONFIG)
========================================================= */

const env = window.__ENV__ || {};
export const API_URL = env.API_URL;
export const DEF_LANG = env.DEF_LANG || "en";

fetch(`${API_URL}/v1/some-endpoint`);

/* =========================================================
   FETCH WRAPPER (API COMMUNICATION)
========================================================= */

const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

/**
 * Create an API client with baseURL + default options.
 */
export function createApiClient({ baseURL, defaultHeaders = {}, withAuthToken } = {}) {
  async function request(path, { method = 'GET', data, headers = {}, signal } = {}) {
    const url = baseURL ? `${baseURL}${path}` : path;
    const finalHeaders = { ...DEFAULT_HEADERS, ...defaultHeaders, ...headers };

    if (withAuthToken && typeof withAuthToken === 'function') {
      const token = await withAuthToken();
      if (token) finalHeaders['Authorization'] = `Bearer ${token}`;
    }

    const options = {
      method,
      headers: finalHeaders,
      signal,
    };

    if (data !== undefined) {
      // If data is FormData or similar, don't JSON-stringify
      if (data instanceof FormData) {
        delete options.headers['Content-Type'];
        options.body = data;
      } else {
        options.body = JSON.stringify(data);
      }
    }

    const response = await fetch(url, options);

    let responseBody;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }

    if (!response.ok) {
      const error = new Error('API error');
      error.status = response.status;
      error.body = responseBody;
      throw error;
    }

    return responseBody;
  }

  return {
    get: (path, options = {}) => request(path, { ...options, method: 'GET' }),
    post: (path, data, options = {}) => request(path, { ...options, method: 'POST', data }),
    put: (path, data, options = {}) => request(path, { ...options, method: 'PUT', data }),
    del: (path, options = {}) => request(path, { ...options, method: 'DELETE' }),
    raw: request,
  };
}

/* Example: create an API client */
export const api = createApiClient({
  baseURL: 'https://api.example.com/v1',
  withAuthToken: async () => localStorage.getItem('auth_token'),
});

/* =========================================================
   ABORTABLE REQUEST WITH TIMEOUT
========================================================= */

/**
 * Perform an API GET with a timeout using AbortController.
 */
export async function apiGetWithTimeout(path, { timeout = 5000 } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const data = await api.get(path, { signal: controller.signal });
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn('Request aborted (timeout)');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/* =========================================================
   EVENT BUS (PUB / SUB)
========================================================= */

export const EventBus = {
  events: {},

  on(eventName, handler) {
    if (!this.events[eventName]) this.events[eventName] = [];
    this.events[eventName].push(handler);
  },

  off(eventName, handler) {
    if (!this.events[eventName]) return;
    this.events[eventName] = this.events[eventName].filter((h) => h !== handler);
  },

  emit(eventName, payload) {
    if (!this.events[eventName]) return;
    for (const handler of this.events[eventName]) {
      handler(payload);
    }
  },
};

/* =========================================================
   LIVE SOCKETS (WEBSOCKET WRAPPER)
========================================================= */

export class ReconnectingWebSocket {
  /**
   * @param {string} url
   * @param {object} options
   *  - maxRetries
   *  - reconnectDelay
   */
  constructor(url, { maxRetries = 5, reconnectDelay = 2000 } = {}) {
    this.url = url;
    this.maxRetries = maxRetries;
    this.reconnectDelay = reconnectDelay;
    this.retryCount = 0;
    this.socket = null;
    this.listeners = {
      open: [],
      message: [],
      close: [],
      error: [],
    };

    this.connect();
  }

  connect() {
    this.socket = new WebSocket(this.url);

    this.socket.addEventListener('open', (event) => {
      this.retryCount = 0;
      this._emit('open', event);
    });

    this.socket.addEventListener('message', (event) => {
      try {
        const parsed = JSON.parse(event.data);
        this._emit('message', parsed);
      } catch {
        this._emit('message', event.data);
      }
    });

    this.socket.addEventListener('close', (event) => {
      this._emit('close', event);
      if (this.retryCount < this.maxRetries) {
        this.retryCount += 1;
        setTimeout(() => this.connect(), this.reconnectDelay);
      }
    });

    this.socket.addEventListener('error', (event) => {
      this._emit('error', event);
      this.socket.close();
    });
  }

  _emit(type, payload) {
    for (const fn of this.listeners[type]) {
      fn(payload);
    }
  }

  on(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  off(type, fn) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((h) => h !== fn);
  }

  send(data) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      this.socket.send(payload);
    } else {
      console.warn('WebSocket not open; message not sent');
    }
  }

  close() {
    if (this.socket) {
      this.maxRetries = 0; // disable reconnect
      this.socket.close();
    }
  }
}

/* Example usage: a live updates channel */
// const liveSocket = new ReconnectingWebSocket('wss://example.com/live');
// liveSocket.on('open', () => console.log('Socket connected'));
// liveSocket.on('message', (msg) => console.log('Got msg:', msg));

/* =========================================================
   FORMS: VALIDATION + API SUBMISSION
========================================================= */

/**
 * Simple form helper to:
 *  - prevent default submit
 *  - collect values
 *  - validate required fields
 *  - call a handler
 */
export function attachFormHandler(formSelector, onSubmit) {
  const form = $(formSelector);
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const values = Object.fromEntries(formData.entries());

    // Basic validation: elements with [data-required]
    const requiredFields = $$('[data-required]', form);
    let hasError = false;

    requiredFields.forEach((el) => {
      const name = el.name || el.getAttribute('data-name');
      const value = values[name];
      if (!value || String(value).trim() === '') {
        hasError = true;
        el.classList.add('input-error');
      } else {
        el.classList.remove('input-error');
      }
    });

    if (hasError) {
      showToast('Please fill in required fields', { type: 'error' });
      return;
    }

    try {
      form.classList.add('is-submitting');

      await onSubmit(values, formData);

      showToast('Form submitted successfully');
      form.reset();
    } catch (error) {
      console.error(error);
      showToast('Something went wrong while submitting', { type: 'error' });
    } finally {
      form.classList.remove('is-submitting');
    }
  });
}

/* Example: attach to a login form */
export function setupLoginForm() {
  attachFormHandler('#loginForm', async (values) => {
    const { email, password } = values;
    const response = await api.post('/auth/login', { email, password });

    // Example: store token
    localStorage.setItem('auth_token', response.token);

    EventBus.emit('login:success', response.user);
  });
}

/* =========================================================
   LIVE SEARCH EXAMPLE (DEBOUNCE + API)
========================================================= */

export function setupLiveSearch({
  inputSelector,
  resultsContainerSelector,
  endpoint = '/search',
}) {
  const input = $(inputSelector);
  const resultsContainer = $(resultsContainerSelector);

  if (!input || !resultsContainer) return;

  const runSearch = debounce(async () => {
    const query = input.value.trim();
    if (!query) {
      resultsContainer.innerHTML = '';
      return;
    }

    try {
      resultsContainer.innerHTML = '<p>Loading…</p>';

      const results = await api.get(`${endpoint}?q=${encodeURIComponent(query)}`);

      if (!Array.isArray(results)) {
        resultsContainer.innerHTML = '<p>No results</p>';
        return;
      }

      resultsContainer.innerHTML = results
        .map(
          (item) => `
        <article class="search-result">
          <h4>${escapeHtml(item.title || 'Untitled')}</h4>
          <p>${escapeHtml(item.summary || '')}</p>
        </article>
      `
        )
        .join('');
    } catch (error) {
      console.error(error);
      resultsContainer.innerHTML = '<p>Error loading results</p>';
    }
  }, 300);

  input.addEventListener('input', runSearch);
}

/* Small HTML escape helper */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* =========================================================
   TOAST / NOTIFICATION UTILITY
========================================================= */

let toastContainer;

export function showToast(message, { type = 'info', duration = 3000 } = {}) {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-hide');
    toast.addEventListener(
      'transitionend',
      () => {
        toast.remove();
        if (!toastContainer.hasChildNodes()) {
          toastContainer.remove();
          toastContainer = null;
        }
      },
      { once: true }
    );
  }, duration);
}

/* =========================================================
   LOCAL STORAGE HELPERS
========================================================= */

export const storage = {
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
  get(key, defaultValue = null) {
    const raw = localStorage.getItem(key);
    if (!raw) return defaultValue;
    try {
      return JSON.parse(raw);
    } catch {
      return defaultValue;
    }
  },
  remove(key) {
    localStorage.removeItem(key);
  },
  clear() {
    localStorage.clear();
  },
};

/* =========================================================
   INIT EXAMPLE
========================================================= */

export function initApp() {
  // Example: setup login form, live search, etc.
  setupLoginForm();
  setupLiveSearch({
    inputSelector: '#searchInput',
    resultsContainerSelector: '#searchResults',
    endpoint: '/items/search',
  });

  // Example: listen for login success
  EventBus.on('login:success', (user) => {
    showToast(`Welcome, ${user.name}`, { type: 'success' });
  });

  // Example WebSocket usage
  // const socket = new ReconnectingWebSocket('wss://example.com/notifications');
  // socket.on('message', (msg) => {
  //   if (msg.type === 'notification') {
  //     showToast(msg.text, { type: 'info', duration: 5000 });
  //   }
  // });
}

// Auto-init when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});