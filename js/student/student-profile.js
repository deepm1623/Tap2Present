import { requireRole, logout } from "../auth.js";
const session = await requireRole("student");
document.querySelectorAll("[data-name]").forEach((element) => { element.textContent = session.profile.name || "Student"; });
document.querySelector("[data-email]").textContent = session.profile.email || session.user.email || "Not provided";
document.querySelector("[data-logout]").addEventListener("click", async (event) => { event.preventDefault(); await logout(); });
