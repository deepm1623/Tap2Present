import { requireRole, logout } from "../auth.js";

export async function setupStudentPortal() {
    const session = await requireRole("student");
    const profile = session.profile;
    const name = profile.name || "Student";

    document.querySelectorAll("[data-name]").forEach(element => {
        element.textContent = name;
    });

    document.querySelectorAll("[data-email]").forEach(element => {
        element.textContent = profile.email || session.user.email || "Not provided";
    });

    document.querySelectorAll("[data-student-id]").forEach(element => {
        element.textContent = profile.studentId || "Not assigned";
    });

    document.querySelectorAll("[data-initial]").forEach(element => {
        element.textContent = name.charAt(0).toUpperCase();
    });

    document.querySelectorAll("[data-logout]").forEach(element => {
        element.addEventListener("click", async event => {
            event.preventDefault();
            await logout();
        });
    });

    return session;
}
