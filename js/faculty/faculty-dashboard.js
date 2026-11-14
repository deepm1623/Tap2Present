import { requireRole, logout } from "../auth.js";
const session = await requireRole("faculty");
document.querySelector("[data-name]").textContent = session.profile.name || "Faculty";
document.querySelector("[data-logout]").addEventListener("click", async (event) => { event.preventDefault(); await logout(); });
