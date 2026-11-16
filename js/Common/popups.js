const popupState = {
    activeModal: null,
    activeClose: null,
    previousFocusedElement: null,
    loadingCount: 0
};

let toastContainer = null;
let popupReadyResolve;
let popupReadyReject;

const popupReady = new Promise((resolve, reject) => {
    popupReadyResolve = resolve;
    popupReadyReject = reject;
});

window.popupReady = popupReady;
popupReady.catch(() => {});

function setScrollLock(locked) {
    document.body.classList.toggle("app-modal-open", locked);
}

function updateScrollLock() {
    setScrollLock(Boolean(popupState.activeModal || popupState.loadingCount));
}

function focusFirstControl(container) {
    const control = container.querySelector(
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])"
    );

    control?.focus();
}

function finishModal(modal, result) {
    if (!modal) return;

    modal.classList.remove("show");

    if (popupState.activeModal === modal) {
        popupState.activeModal = null;
    }
    popupState.activeClose = null;

    updateScrollLock();
    popupState.previousFocusedElement?.focus?.();
    popupState.previousFocusedElement = null;
    modal.dispatchEvent(new CustomEvent("appmodalclose"));

    return result;
}

async function loadGlobalPopups() {
    if (document.getElementById("globalConfirmModal") &&
        document.getElementById("globalLoadingModal") &&
        document.getElementById("appToastContainer")) {
        toastContainer = document.getElementById("appToastContainer");
        popupReadyResolve();
        return;
    }

    const script = document.currentScript;
    const componentUrl = script
        ? new URL("../../components/global-popups.html", script.src)
        : new URL("../components/global-popups.html", document.baseURI);

    try {
        const response = await fetch(componentUrl);

        if (!response.ok) {
            throw new Error(`Failed to load global popups: ${response.status}`);
        }

        const template = document.createElement("template");
        template.innerHTML = await response.text();

        Array.from(template.content.children).forEach(element => {
            if (!element.id || !document.getElementById(element.id)) {
                document.body.appendChild(element);
            }
        });

        toastContainer = document.getElementById("appToastContainer");
        popupReadyResolve();
    } catch (error) {
        popupReadyReject(error);
        console.error("Unable to load the global popup component.", error);
    }
}

function getModalParts() {
    const modal = document.getElementById("globalConfirmModal");

    if (!modal) {
        throw new Error("Global popup component is not available.");
    }

    return {
        modal,
        title: document.getElementById("confirmTitle"),
        description: document.getElementById("confirmDescription"),
        accept: document.getElementById("confirmAccept"),
        cancel: document.getElementById("confirmCancel"),
        close: document.getElementById("confirmClose"),
        icon: document.getElementById("confirmIcon"),
        body: document.getElementById("confirmBody")
    };
}

function openModal(modal) {
    if (popupState.activeModal && popupState.activeModal !== modal) {
        finishModal(popupState.activeModal, false);
    }

    popupState.activeModal = modal;
    popupState.previousFocusedElement = document.activeElement;
    modal.classList.add("show");
    updateScrollLock();
    focusFirstControl(modal);
}

function closeAppModal(id) {
    const modal = document.getElementById(id);
    finishModal(modal, false);
}

async function showToast(message, type = "success", title = "") {
    await popupReady;

    const settings = {
        success: { icon: "✓", title: title || "Success" },
        error: { icon: "!", title: title || "Something went wrong" },
        warning: { icon: "!", title: title || "Warning" },
        info: { icon: "i", title: title || "Information" }
    };

    const current = settings[type] || settings.info;
    const toast = document.createElement("div");
    toast.className = `app-toast ${type}`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");

    const icon = document.createElement("span");
    icon.className = "app-toast-icon";
    icon.textContent = current.icon;
    icon.setAttribute("aria-hidden", "true");

    const content = document.createElement("div");
    content.className = "app-toast-content";

    const heading = document.createElement("strong");
    heading.textContent = current.title;

    const description = document.createElement("p");
    description.textContent = message;

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "app-toast-dismiss";
    dismiss.setAttribute("aria-label", "Dismiss notification");
    dismiss.textContent = "×";

    let removeTimer;
    const remove = () => {
        clearTimeout(removeTimer);
        toast.classList.add("removing");
        setTimeout(() => toast.remove(), 250);
    };

    dismiss.addEventListener("click", remove);
    content.append(heading, description);
    toast.append(icon, content, dismiss);
    toastContainer.appendChild(toast);
    removeTimer = setTimeout(remove, 4500);

    return toast;
}

async function showConfirm({
    title = "Are you sure?",
    message = "This action cannot be undone.",
    confirmText = "Continue",
    cancelText = "Cancel",
    danger = true,
    type = danger ? "danger" : "info"
} = {}) {
    await popupReady;

    const parts = getModalParts();
    parts.title.textContent = title;
    parts.description.textContent = message;
    parts.accept.textContent = confirmText;
    parts.cancel.textContent = cancelText;
    parts.cancel.hidden = !cancelText;
    parts.close.hidden = false;
    parts.body.replaceChildren();
    parts.accept.className = `app-modal-btn ${danger ? "app-modal-btn-danger" : "app-modal-btn-primary"}`;
    parts.icon.className = `app-confirm-icon ${type}`;
    parts.icon.textContent = type === "success" ? "✓" : type === "info" ? "i" : "!";

    openModal(parts.modal);
    parts.accept.focus();

    return new Promise(resolve => {
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            parts.accept.removeEventListener("click", accept);
            parts.cancel.removeEventListener("click", cancel);
            parts.close.removeEventListener("click", cancel);
            parts.modal.removeEventListener("click", outsideClick);
            parts.modal.removeEventListener("keydown", keydown);
            finishModal(parts.modal, result);
            resolve(result);
        };
        const accept = () => finish(true);
        const cancel = () => finish(false);
        const outsideClick = event => {
            if (event.target === parts.modal) cancel();
        };
        const keydown = event => {
            if (event.key === "Escape") cancel();
            if (event.key === "Enter" && event.target === parts.modal) accept();
        };

        parts.accept.addEventListener("click", accept);
        parts.cancel.addEventListener("click", cancel);
        parts.close.addEventListener("click", cancel);
        parts.modal.addEventListener("click", outsideClick);
        parts.modal.addEventListener("keydown", keydown);
        popupState.activeClose = cancel;
    });
}

async function showInfo({ title = "Information", message = "", confirmText = "Close", type = "info" } = {}) {
    const result = await showConfirm({
        title,
        message,
        confirmText,
        cancelText: "",
        danger: false,
        type
    });
    return result;
}

async function showInput({
    title = "Enter information",
    message = "",
    confirmText = "Save",
    cancelText = "Cancel",
    fields = [],
    validate
} = {}) {
    await popupReady;

    const parts = getModalParts();
    const normalizedFields = fields.length ? fields : [{ name: "value", label: "Value", required: true }];
    parts.title.textContent = title;
    parts.description.textContent = message;
    parts.accept.textContent = confirmText;
    parts.cancel.textContent = cancelText;
    parts.cancel.hidden = false;
    parts.close.hidden = false;
    parts.icon.className = "app-confirm-icon info";
    parts.icon.textContent = "i";
    parts.body.replaceChildren();

    const controls = new Map();
    normalizedFields.forEach(field => {
        const group = document.createElement("div");
        group.className = "app-modal-group";

        const label = document.createElement("label");
        label.htmlFor = `app-input-${field.name}`;
        label.textContent = field.label || field.name;

        const input = document.createElement(field.type === "textarea" ? "textarea" : "input");
        input.id = label.htmlFor;
        input.name = field.name;
        if (field.type !== "textarea") {
            input.type = field.type || "text";
        }
        input.placeholder = field.placeholder || "";
        input.value = field.value || "";
        input.required = Boolean(field.required);
        if (field.minLength) input.minLength = field.minLength;
        if (field.autocomplete) input.autocomplete = field.autocomplete;

        const error = document.createElement("small");
        error.className = "app-modal-field-error";
        error.setAttribute("role", "alert");

        group.append(label, input, error);
        parts.body.appendChild(group);
        controls.set(field.name, { field, input, error });
    });

    openModal(parts.modal);
    controls.values().next().value?.input?.focus();

    return new Promise(resolve => {
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            parts.accept.removeEventListener("click", accept);
            parts.cancel.removeEventListener("click", cancel);
            parts.close.removeEventListener("click", cancel);
            parts.modal.removeEventListener("click", outsideClick);
            parts.modal.removeEventListener("keydown", keydown);
            finishModal(parts.modal, result);
            resolve(result);
        };
        const cancel = () => finish(null);
        const accept = () => {
            const values = Object.fromEntries(
                Array.from(controls, ([name, control]) => [name, control.input.value.trim()])
            );
            let validationMessage = "";

            controls.forEach(control => {
                const value = values[control.field.name];
                control.error.textContent = "";
                if (control.field.required && !value) {
                    control.error.textContent = `${control.field.label || control.field.name} is required.`;
                    validationMessage = control.error.textContent;
                } else if (control.field.validate) {
                    const result = control.field.validate(value, values);
                    if (result !== true) {
                        control.error.textContent = result || "Enter a valid value.";
                        validationMessage = control.error.textContent;
                    }
                }
            });

            if (!validationMessage && validate) {
                validationMessage = validate(values) || "";
            }

            if (validationMessage) {
                const firstError = Array.from(controls.values()).find(control => control.error.textContent);
                firstError?.input.focus();
                return;
            }

            finish(values);
        };
        const outsideClick = event => {
            if (event.target === parts.modal) cancel();
        };
        const keydown = event => {
            if (event.key === "Escape") cancel();
            if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
                event.preventDefault();
                accept();
            }
        };

        parts.accept.addEventListener("click", accept);
        parts.cancel.addEventListener("click", cancel);
        parts.close.addEventListener("click", cancel);
        parts.modal.addEventListener("click", outsideClick);
        parts.modal.addEventListener("keydown", keydown);
        popupState.activeClose = cancel;
    });
}

async function showLoading(message = "Please wait...", title = "Working...") {
    await popupReady;

    const modal = document.getElementById("globalLoadingModal");
    modal.querySelector("[data-loading-title]").textContent = title;
    modal.querySelector("[data-loading-message]").textContent = message;
    modal.classList.add("show");
    setScrollLock(true);
    popupState.loadingCount += 1;
    return {
        close() {
            if (popupState.loadingCount > 0) popupState.loadingCount -= 1;
            if (!popupState.loadingCount) {
                modal.classList.remove("show");
                updateScrollLock();
            }
        }
    };
}

async function withLoading(operation, message, title) {
    const loading = await showLoading(message, title);
    try {
        return await operation();
    } finally {
        loading.close();
    }
}

function openAppModal(id) {
    const modal = document.getElementById(id);
    if (modal) openModal(modal);
}

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && popupState.activeClose) {
        event.preventDefault();
        popupState.activeClose();
    }
});

window.openAppModal = openAppModal;
window.closeAppModal = closeAppModal;
window.showToast = showToast;
window.showSuccess = (message, title) => showToast(message, "success", title);
window.showError = (message, title) => showToast(message, "error", title);
window.showWarning = (message, title) => showToast(message, "warning", title);
window.showInformation = (message, title) => showToast(message, "info", title);
window.showConfirm = showConfirm;
window.showInfo = showInfo;
window.showInput = showInput;
window.showLoading = showLoading;
window.withLoading = withLoading;

function initializeMobileNavigation() {
    const sidebar = document.querySelector(
        ".dashboard-sidebar, .history-sidebar, .nfc-sidebar"
    );

    if (!sidebar || document.querySelector(".mobile-nav-toggle")) {
        return;
    }

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "mobile-nav-toggle";
    toggle.setAttribute("aria-label", "Open navigation menu");
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = "☰";

    const backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "mobile-nav-backdrop";
    backdrop.setAttribute("aria-label", "Close navigation menu");

    const style = document.createElement("style");
    style.textContent = `
        .mobile-nav-toggle,
        .mobile-nav-backdrop { display: none; }
        @media (max-width: 900px) {
            .mobile-nav-toggle {
                position: fixed;
                top: max(12px, env(safe-area-inset-top));
                left: max(12px, env(safe-area-inset-left));
                z-index: 1002;
                display: grid;
                width: 46px;
                height: 46px;
                place-items: center;
                padding: 0;
                border: 1px solid rgba(255,255,255,.14);
                border-radius: 12px;
                color: #fff;
                background: #192530;
                box-shadow: 0 10px 24px rgba(0,0,0,.24);
                cursor: pointer;
                font-size: 22px;
            }
            .mobile-nav-backdrop {
                position: fixed;
                inset: 0;
                z-index: 1000;
                width: 100%;
                height: 100%;
                padding: 0;
                border: 0;
                background: rgba(3,8,13,.62);
                cursor: pointer;
            }
            body.mobile-nav-open .mobile-nav-backdrop { display: block; }
            body.mobile-nav-open .dashboard-sidebar,
            body.mobile-nav-open .history-sidebar,
            body.mobile-nav-open .nfc-sidebar {
                transform: translateX(0) !important;
            }
            .dashboard-sidebar,
            .history-sidebar,
            .nfc-sidebar {
                position: fixed !important;
                inset: 0 auto 0 0;
                z-index: 1001;
                width: min(86vw, 310px) !important;
                min-width: 0 !important;
                height: 100dvh;
                max-height: 100dvh;
                padding-top: max(22px, calc(env(safe-area-inset-top) + 10px)) !important;
                padding-bottom: max(22px, calc(env(safe-area-inset-bottom) + 10px)) !important;
                overflow-y: auto;
                transform: translateX(-105%) !important;
                transition: transform .22s ease;
                box-shadow: 18px 0 38px rgba(0,0,0,.28);
            }
            .dashboard-main,
            .history-main,
            .nfc-main {
                width: 100%;
                max-width: none;
                padding-top: 78px !important;
            }
        }
        @media (prefers-reduced-motion: reduce) {
            .dashboard-sidebar,
            .history-sidebar,
            .nfc-sidebar { transition: none; }
        }
    `;

    function closeNavigation() {
        document.body.classList.remove("mobile-nav-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open navigation menu");
    }

    toggle.addEventListener("click", function () {
        const isOpen = document.body.classList.toggle("mobile-nav-open");
        toggle.setAttribute("aria-expanded", String(isOpen));
        toggle.setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
    });
    backdrop.addEventListener("click", closeNavigation);
    sidebar.querySelectorAll("a").forEach(link => link.addEventListener("click", closeNavigation));
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") closeNavigation();
    });

    document.head.appendChild(style);
    document.body.append(toggle, backdrop);
}

loadGlobalPopups();
initializeMobileNavigation();
