
import { auth, db } from "../../firebase-config.js";

import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
  getApp,
  getApps,
  initializeApp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  runTransaction,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

/* =========================================
   FIREBASE SECONDARY AUTH
   Creates student accounts without logging
   the current administrator out.
========================================= */

const defaultApp = getApp();

let secondaryApp = getApps().find(
  app => app.name === "StudentAccountCreator"
);

if (!secondaryApp) {
  secondaryApp = initializeApp(
    defaultApp.options,
    "StudentAccountCreator"
  );
}

const studentAuth = getAuth(secondaryApp);

/* =========================================
   DOM ELEMENTS
========================================= */

const adminName = document.getElementById("adminName");
const adminAvatar = document.getElementById("adminAvatar");
const logoutButton = document.getElementById("logoutButton");

const totalStudents = document.getElementById("totalStudents");
const activeStudents = document.getElementById("activeStudents");
const inactiveStudents = document.getElementById("inactiveStudents");
const departmentCount = document.getElementById("departmentCount");

const studentsTableBody = document.getElementById("studentsTableBody");
const searchStudents = document.getElementById("searchStudents");
const statusFilter = document.getElementById("statusFilter");

const addStudentButton = document.getElementById("addStudentButton");
const refreshStudentsButton = document.getElementById("refreshStudentsButton");

const studentModal = document.getElementById("studentModal");
const closeStudentModal = document.getElementById("closeStudentModal");
const studentForm = document.getElementById("studentForm");

const studentName = document.getElementById("studentName");
const studentEmail = document.getElementById("studentEmail");
const studentPassword = document.getElementById("studentPassword");
const studentDepartment = document.getElementById("studentDepartment");
const studentSemester = document.getElementById("studentSemester");
const studentDivision = document.getElementById("studentDivision");

const formMessage = document.getElementById("formMessage");
const saveStudentButton = document.getElementById("saveStudentButton");

const studentMessage = document.getElementById("studentMessage");

/* Edit modal */

const editStudentModal = document.getElementById("editStudentModal");
const editStudentForm = document.getElementById("editStudentForm");
const closeEditModal = document.getElementById("closeEditModal");

const editStudentUid = document.getElementById("editStudentUid");
const editStudentName = document.getElementById("editStudentName");
const editStudentEmail = document.getElementById("editStudentEmail");
const editStudentDepartment = document.getElementById("editStudentDepartment");
const editStudentSemester = document.getElementById("editStudentSemester");
const editStudentDivision = document.getElementById("editStudentDivision");

const editStudentMessage = document.getElementById("editStudentMessage");
const updateStudentButton = document.getElementById("updateStudentButton");

/* NFC modal */

const nfcModal = document.getElementById("nfcModal");
const closeNfcModal = document.getElementById("closeNfcModal");
const nfcStudentName = document.getElementById("nfcStudentName");
const nfcCode = document.getElementById("nfcCode");
const copyNfcButton = document.getElementById("copyNfcButton");
const nfcMessage = document.getElementById("nfcMessage");

/* Bulk import */

const downloadTemplateButton = document.getElementById("downloadTemplateButton");
const chooseFileButton = document.getElementById("chooseFileButton");
const bulkStudentFile = document.getElementById("bulkStudentFile");
const importPreview = document.getElementById("importPreview");
const importProgress = document.getElementById("importProgress");
const startImportButton = document.getElementById("startImportButton");

/* =========================================
   GLOBAL DATA
========================================= */

let students = [];
let currentAdmin = null;
let selectedNfcStudent = null;
let importedStudents = [];
let isImporting = false;

/* =========================================
   HELPER FUNCTIONS
========================================= */

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, character => {
    const characters = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };

    return characters[character];
  });
}

function showMessage(element, message, type = "") {
  element.textContent = message;
  element.className = "admin-message";

  if (type) {
    element.classList.add(type);
  }
}

function openModal(modal) {
  modal.classList.add("show");
}

function closeModal(modal) {
  modal.classList.remove("show");
}

function normalizeSemester(value) {
  return Number(value);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function getStudentByUid(uid) {
  return students.find(student => student.uid === uid);
}

function getHighestStudentNumber() {
  return students.reduce((highest, student) => {
    const match = String(student.studentId || "").match(/^STU(\d+)$/i);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
}

/* =========================================
   AUTHENTICATION AND ADMIN CHECK
========================================= */

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "admin-login.html";
    return;
  }

  try {
    const adminRef = doc(db, "users", user.uid);
    const adminSnapshot = await getDoc(adminRef);

    if (!adminSnapshot.exists()) {
      await signOut(auth);
      window.location.href = "admin-login.html";
      return;
    }

    const adminData = adminSnapshot.data();

    if (
      adminData.role !== "admin" ||
      adminData.status !== "active"
    ) {
      await signOut(auth);
      window.location.href = "admin-login.html";
      return;
    }

    currentAdmin = user;

    adminName.textContent = adminData.name || "Administrator";
    adminAvatar.textContent =
      (adminData.name || "A").charAt(0).toUpperCase();

    await loadStudents();

  } catch (error) {
    console.error("Admin authentication error:", error);

    showMessage(
      studentMessage,
      "Unable to verify administrator access: " + error.message,
      "error"
    );
  }
});

/* =========================================
   LOGOUT
========================================= */

logoutButton.addEventListener("click", async () => {
  const confirmed = await window.showConfirm({
    title: "Log out of Tap2Present?",
    message: "You will need to sign in again to manage students.",
    confirmText: "Log out"
  });

  if (!confirmed) return;

  try {
    await signOut(auth);
    window.location.href = "admin-login.html";
  } catch (error) {
    console.error("Logout error:", error);
    showMessage(studentMessage, error.message, "error");
  }
});

/* =========================================
   LOAD STUDENTS
========================================= */

async function loadStudents() {
  studentsTableBody.innerHTML = `
    <tr>
      <td colspan="6" class="admin-empty-cell">
        Loading students...
      </td>
    </tr>
  `;

  try {
    const studentsQuery = query(
      collection(db, "users"),
      where("role", "==", "student")
    );

    const snapshot = await getDocs(studentsQuery);

    students = snapshot.docs.map(studentDoc => ({
      uid: studentDoc.id,
      ...studentDoc.data()
    }));

    students.sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""))
    );

    updateStatistics();
    renderStudents();

  } catch (error) {
    console.error("Load students error:", error);

    studentsTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="admin-empty-cell">
          Unable to load students. Check your Firestore rules.
        </td>
      </tr>
    `;

    showMessage(studentMessage, error.message, "error");
  }
}

/* =========================================
   STATISTICS
========================================= */

function updateStatistics() {
  const active = students.filter(
    student => student.status === "active"
  ).length;

  const inactive = students.length - active;

  const departments = new Set(
    students
      .map(student => String(student.department || "").trim().toLowerCase())
      .filter(Boolean)
  );

  totalStudents.textContent = students.length;
  activeStudents.textContent = active;
  inactiveStudents.textContent = inactive;
  departmentCount.textContent = departments.size;
}

/* =========================================
   RENDER STUDENT DIRECTORY
========================================= */

function renderStudents() {
  const searchTerm = searchStudents.value.trim().toLowerCase();
  const selectedStatus = statusFilter.value;

  const filteredStudents = students.filter(student => {
    const searchableText = [
      student.name,
      student.email,
      student.studentId,
      student.department
    ].join(" ").toLowerCase();

    const matchesSearch = searchableText.includes(searchTerm);

    const matchesStatus =
      selectedStatus === "all" ||
      student.status === selectedStatus;

    return matchesSearch && matchesStatus;
  });

  if (!filteredStudents.length) {
    studentsTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="admin-empty-cell">
          No students found.
        </td>
      </tr>
    `;
    return;
  }

  studentsTableBody.innerHTML = filteredStudents.map(student => {
    const status =
      student.status === "active" ? "active" : "inactive";

    return `
      <tr>
        <td>
          <span class="admin-student-name">
            ${escapeHTML(student.name || "Unnamed")}
          </span>
          <span class="admin-student-email">
            ${escapeHTML(student.email || "")}
          </span>
        </td>

        <td>${escapeHTML(student.studentId || "-")}</td>
        <td>${escapeHTML(student.department || "-")}</td>
        <td>${escapeHTML(student.semester || "-")}</td>

        <td>
          <span class="admin-status ${status}">
            ${status}
          </span>
        </td>

        <td>
          <div class="admin-action-group">

            <button class="admin-action-button"
              type="button"
              data-action="edit"
              data-uid="${escapeHTML(student.uid)}">
              Edit
            </button>

            <button class="admin-action-button"
              type="button"
              data-action="nfc"
              data-uid="${escapeHTML(student.uid)}">
              NFC ID
            </button>

            <button class="admin-action-button reset-button"
              type="button"
              data-action="reset"
              data-uid="${escapeHTML(student.uid)}">
              Reset Password
            </button>

            <button class="admin-action-button"
              type="button"
              data-action="toggle"
              data-uid="${escapeHTML(student.uid)}">
              ${status === "active" ? "Deactivate" : "Activate"}
            </button>

          </div>
        </td>
      </tr>
    `;
  }).join("");
}

/* =========================================
   SEARCH AND FILTER
========================================= */

searchStudents.addEventListener("input", renderStudents);
statusFilter.addEventListener("change", renderStudents);

refreshStudentsButton.addEventListener("click", loadStudents);

/* =========================================
   GENERATE STUDENT ID
========================================= */

/*
  The counter document stores the last assigned
  student number.

  If STU001 and STU002 already exist, initialize
  the counter document with lastNumber: 2.
*/

async function generateStudentId(transaction) {
  const counterRef = doc(db, "counters", "studentIds");

  const counterSnapshot = await transaction.get(counterRef);

  const lastNumber = counterSnapshot.exists()
    ? Number(counterSnapshot.data().lastNumber || 0)
    : getHighestStudentNumber();

  const nextNumber = lastNumber + 1;

  transaction.set(counterRef, {
    lastNumber: nextNumber,
    updatedAt: serverTimestamp()
  });

  return "STU" + String(nextNumber).padStart(3, "0");
}

/* =========================================
   CREATE STUDENT ACCOUNT
========================================= */

async function createStudentAccount(studentData) {
  let createdUser = null;

  try {
    const credential = await createUserWithEmailAndPassword(
      studentAuth,
      normalizeEmail(studentData.email),
      studentData.password
    );

    createdUser = credential.user;

    const studentRef = doc(db, "users", createdUser.uid);

    const studentId = await runTransaction(db, async transaction => {
      const generatedId = await generateStudentId(transaction);

      transaction.set(studentRef, {
        name: studentData.name.trim(),
        email: normalizeEmail(studentData.email),
        role: "student",
        status: "active",
        studentId: generatedId,
        department: studentData.department.trim(),
        className: studentData.department.trim(),
        classId: studentData.department.trim(),
        class: studentData.department.trim(),
        division: studentData.division,
        semester: normalizeSemester(studentData.semester),
        createdBy: currentAdmin.uid,
        createdAt: serverTimestamp()
      });

      return generatedId;
    });

    return {
      success: true,
      studentId,
      uid: createdUser.uid
    };

  } catch (error) {
    console.error("Student creation error:", error);

    if (createdUser) {
      throw new Error(
        "Authentication account was created, but the Firestore profile failed. " +
        "Check Firestore rules before retrying. Original error: " +
        error.message
      );
    }

    throw error;

  } finally {
    if (studentAuth.currentUser) {
      try {
        await signOut(studentAuth);
      } catch (signOutError) {
        console.error("Secondary Auth sign out error:", signOutError);
      }
    }
  }
}

/* =========================================
   ADD STUDENT MODAL
========================================= */

addStudentButton.addEventListener("click", () => {
  studentForm.reset();
  showMessage(formMessage, "");
  openModal(studentModal);
});

closeStudentModal.addEventListener("click", () => {
  closeModal(studentModal);
});

studentModal.addEventListener("click", event => {
  if (event.target === studentModal) {
    closeModal(studentModal);
  }
});

studentForm.addEventListener("submit", async event => {
  event.preventDefault();

  const studentData = {
    name: studentName.value.trim(),
    email: normalizeEmail(studentEmail.value),
    password: studentPassword.value,
    department: studentDepartment.value.trim(),
    semester: studentSemester.value,
    division: studentDivision?.value.trim() || ""
  };

  if (
    !studentData.name ||
    !studentData.email ||
    !studentData.department ||
    !studentData.semester ||
    studentData.password.length < 6
  ) {
    showMessage(
      formMessage,
      "Please complete all fields correctly.",
      "error"
    );
    return;
  }

  saveStudentButton.disabled = true;
  saveStudentButton.textContent = "Creating Account...";

  try {
    const result = await window.withLoading(
      () => createStudentAccount(studentData),
      "Creating the student account and profile.",
      "Creating student"
    );

    showMessage(
      formMessage,
      `Student created successfully. ID: ${result.studentId}`,
      "success"
    );
    window.showToast(
      `Student ${result.studentId} was added successfully.`,
      "success",
      "Student added"
    );

    studentForm.reset();
    await loadStudents();

    setTimeout(() => {
      closeModal(studentModal);
    }, 1200);

  } catch (error) {
    showMessage(formMessage, error.message, "error");

  } finally {
    saveStudentButton.disabled = false;
    saveStudentButton.textContent = "Create Student Account";
  }
});

/* =========================================
   STUDENT DIRECTORY ACTIONS
========================================= */

studentsTableBody.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");

  if (!button) return;

  const action = button.dataset.action;
  const uid = button.dataset.uid;
  const student = getStudentByUid(uid);

  if (!student) return;

  /* EDIT */

  if (action === "edit") {
    openEditStudent(student);
    return;
  }

  /* NFC */

  if (action === "nfc") {
    selectedNfcStudent = student;

    nfcStudentName.textContent = student.name || "Student";
    nfcCode.textContent = `TAP2P:${student.studentId}`;

    showMessage(nfcMessage, "");
    openModal(nfcModal);
    return;
  }

  /* PASSWORD RESET */

  if (action === "reset") {
    const confirmed = await window.showConfirm({
      title: "Reset student password?",
      message: `Send a password reset email to ${student.email}?`,
      confirmText: "Send reset email",
      danger: false,
      type: "info"
    });

    if (!confirmed) return;

    button.disabled = true;

    try {
      await window.withLoading(
        () => sendPasswordResetEmail(auth, student.email),
        "Sending the password reset email.",
        "Resetting password"
      );

      showMessage(
        studentMessage,
        `Password reset email sent to ${student.email}.`,
        "success"
      );
      window.showToast(
        `Password reset email sent to ${student.email}.`,
        "success",
        "Password reset sent"
      );

    } catch (error) {
      console.error("Password reset error:", error);

      showMessage(
        studentMessage,
        error.message,
        "error"
      );

    } finally {
      button.disabled = false;
    }

    return;
  }

  /* ACTIVATE / DEACTIVATE */

  if (action === "toggle") {
    const newStatus =
      student.status === "active" ? "inactive" : "active";

    const confirmed = await window.showConfirm({
      title: `${newStatus === "active" ? "Activate" : "Deactivate"} student?`,
      message: `${newStatus === "active" ? "Activate" : "Deactivate"} ${student.name}?`,
      confirmText: newStatus === "active" ? "Activate" : "Deactivate",
      danger: newStatus !== "active"
    });

    if (!confirmed) return;

    button.disabled = true;

    try {
      await window.withLoading(
        () => updateDoc(doc(db, "users", uid), {
          status: newStatus,
          updatedAt: serverTimestamp()
        }),
        `${newStatus === "active" ? "Activating" : "Deactivating"} ${student.name}.`,
        newStatus === "active" ? "Activating student" : "Deactivating student"
      );

      showMessage(
        studentMessage,
        `${student.name} is now ${newStatus}.`,
        "success"
      );
      window.showToast(
        `${student.name} is now ${newStatus}.`,
        "success",
        newStatus === "active" ? "Student activated" : "Student deactivated"
      );

      await loadStudents();

    } catch (error) {
      console.error("Status update error:", error);
      showMessage(studentMessage, error.message, "error");

    } finally {
      button.disabled = false;
    }
  }
});

/* =========================================
   EDIT STUDENT INFORMATION
========================================= */

function openEditStudent(student) {
  editStudentUid.value = student.uid;
  editStudentName.value = student.name || "";
  editStudentEmail.value = student.email || "";
  editStudentDepartment.value = student.department || "";
  editStudentSemester.value = student.semester || "";
  editStudentDivision.value = student.division || "";

  showMessage(editStudentMessage, "");
  openModal(editStudentModal);
}

closeEditModal.addEventListener("click", () => {
  closeModal(editStudentModal);
});

editStudentModal.addEventListener("click", event => {
  if (event.target === editStudentModal) {
    closeModal(editStudentModal);
  }
});

editStudentForm.addEventListener("submit", async event => {
  event.preventDefault();

  const uid = editStudentUid.value;

  const updatedInfo = {
    name: editStudentName.value.trim(),
    department: editStudentDepartment.value.trim(),
    semester: Number(editStudentSemester.value),
    division: editStudentDivision?.value.trim() || ""
  };

  if (
    !updatedInfo.name ||
    !updatedInfo.department ||
    !Number.isInteger(updatedInfo.semester) ||
    updatedInfo.semester < 1 ||
    updatedInfo.semester > 8
  ) {
    showMessage(
      editStudentMessage,
      "Please enter valid student information.",
      "error"
    );
    return;
  }

  updateStudentButton.disabled = true;
  updateStudentButton.textContent = "Saving Changes...";

  try {
    await window.withLoading(
      () => updateDoc(doc(db, "users", uid), {
        ...updatedInfo,
        className: updatedInfo.department,
        classId: updatedInfo.department,
        class: updatedInfo.department,
        updatedAt: serverTimestamp()
      }),
      "Saving student information.",
      "Updating student"
    );

    showMessage(
      editStudentMessage,
      "Student information updated successfully.",
      "success"
    );
    window.showToast(
      "Student information updated successfully.",
      "success",
      "Student updated"
    );

    await loadStudents();

    setTimeout(() => {
      closeModal(editStudentModal);
    }, 900);

  } catch (error) {
    console.error("Student update error:", error);

    showMessage(
      editStudentMessage,
      error.message,
      "error"
    );

  } finally {
    updateStudentButton.disabled = false;
    updateStudentButton.textContent = "Save Changes";
  }
});

/* =========================================
   NFC MODAL
========================================= */

closeNfcModal.addEventListener("click", () => {
  closeModal(nfcModal);
});

nfcModal.addEventListener("click", event => {
  if (event.target === nfcModal) {
    closeModal(nfcModal);
  }
});

copyNfcButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(nfcCode.textContent);

    showMessage(nfcMessage, "NFC text copied successfully.", "success");

  } catch (error) {
    showMessage(
      nfcMessage,
      "Unable to copy. Please select and copy the text manually.",
      "error"
    );
  }
});

/* =========================================
   DOWNLOAD CSV TEMPLATE
========================================= */

downloadTemplateButton.addEventListener("click", () => {
  const csvContent = [
    "name,email,password,department,semester,division",
    "Example Student,example@example.com,Temp1234,Computer,3"
  ].join("\n");

  const blob = new Blob([csvContent], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "tap2present-student-template.csv";

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
});

/* =========================================
   SELECT IMPORT FILE
========================================= */

chooseFileButton.addEventListener("click", () => {
  bulkStudentFile.click();
});

bulkStudentFile.addEventListener("change", async () => {
  const file = bulkStudentFile.files[0];

  importedStudents = [];
  startImportButton.disabled = true;
  importProgress.textContent = "";

  if (!file) {
    importPreview.textContent = "No file selected.";
    return;
  }

  try {
    const extension = file.name.split(".").pop().toLowerCase();

    let rows = [];

    if (extension === "csv") {
      const text = await file.text();
      rows = parseCSV(text);

    } else if (extension === "xlsx" || extension === "xls") {
      if (!window.XLSX) {
        throw new Error(
          "Excel library did not load. Check your internet connection."
        );
      }

      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });

      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

      rows = XLSX.utils.sheet_to_json(firstSheet, {
        defval: "",
        raw: false
      });

    } else {
      throw new Error("Unsupported file format.");
    }

    importedStudents = validateImportRows(rows);

    showImportPreview(importedStudents);

    if (importedStudents.length) {
      startImportButton.disabled = false;
      importProgress.textContent =
        `${importedStudents.length} valid students ready to import.`;
    } else {
      importProgress.textContent =
        "No valid student records found.";
    }

  } catch (error) {
    console.error("Import file error:", error);

    importPreview.textContent = error.message;
    importProgress.textContent = "Unable to read this file.";
  }
});

/* =========================================
   CSV PARSER
========================================= */

function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    const nextCharacter = text[i + 1];

    if (character === '"' && insideQuotes && nextCharacter === '"') {
      value += '"';
      i++;
    } else if (character === '"') {
      insideQuotes = !insideQuotes;
    } else if (character === "," && !insideQuotes) {
      row.push(value.trim());
      value = "";
    } else if (
      (character === "\n" || character === "\r") &&
      !insideQuotes
    ) {
      if (character === "\r" && nextCharacter === "\n") {
        i++;
      }

      row.push(value.trim());

      if (row.some(cell => cell !== "")) {
        rows.push(row);
      }

      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  row.push(value.trim());

  if (row.some(cell => cell !== "")) {
    rows.push(row);
  }

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map(header =>
    String(header).trim().toLowerCase()
  );

  return rows.slice(1).map(values => {
    const student = {};

    headers.forEach((header, index) => {
      student[header] = values[index] || "";
    });

    return student;
  });
}

/* =========================================
   VALIDATE IMPORT DATA
========================================= */

function validateImportRows(rows) {
  const validStudents = [];
  const seenEmails = new Set();

  rows.forEach((row, index) => {
    const student = {
      name: String(row.name || "").trim(),
      email: normalizeEmail(row.email),
      password: String(row.password || "").trim(),
      department: String(row.department || "").trim(),
      semester: String(row.semester || "").trim(),
      division: String(row.division || "").trim()
    };

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (
      !student.name ||
      !emailPattern.test(student.email) ||
      student.password.length < 6 ||
      !student.department ||
      !/^[1-8]$/.test(student.semester)
    ) {
      console.warn(`Skipping invalid row ${index + 1}`, row);
      return;
    }

    if (seenEmails.has(student.email)) {
      console.warn(`Skipping duplicate email: ${student.email}`);
      return;
    }

    seenEmails.add(student.email);
    validStudents.push(student);
  });

  return validStudents;
}

/* =========================================
   IMPORT PREVIEW
========================================= */

function showImportPreview(list) {
  if (!list.length) {
    importPreview.textContent = "No valid rows to preview.";
    return;
  }

  const previewRows = list.slice(0, 10);

  importPreview.innerHTML = `
    <p>
      <strong>${list.length}</strong> valid students found.
      Showing first ${previewRows.length}.
    </p>

    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Department</th>
          <th>Semester</th>
        </tr>
      </thead>

      <tbody>
        ${previewRows.map(student => `
          <tr>
            <td>${escapeHTML(student.name)}</td>
            <td>${escapeHTML(student.email)}</td>
            <td>${escapeHTML(student.department)}</td>
            <td>${escapeHTML(student.semester)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

/* =========================================
   START BULK IMPORT
========================================= */

startImportButton.addEventListener("click", async () => {
  if (isImporting || !importedStudents.length) return;

  const confirmed = await window.showConfirm({
    title: "Import student accounts?",
    message: `Import ${importedStudents.length} student accounts?`,
    confirmText: "Start import",
    danger: false,
    type: "info"
  });

  if (!confirmed) return;

  isImporting = true;
  startImportButton.disabled = true;
  chooseFileButton.disabled = true;
  downloadTemplateButton.disabled = true;

  let successful = 0;
  let failed = 0;
  const errors = [];
  const importLoading = await window.showLoading(
    "Creating student accounts from the selected file.",
    "Importing students"
  );

  try {
    for (let index = 0; index < importedStudents.length; index++) {
      const student = importedStudents[index];

      importProgress.textContent =
        `Importing ${index + 1} of ${importedStudents.length}: ${student.name}`;

      try {
        await createStudentAccount(student);
        successful++;

      } catch (error) {
        failed++;

        errors.push(
          `${student.email}: ${error.message}`
        );

        console.error("Bulk import row failed:", student.email, error);
      }
    }
  } finally {
    importLoading.close();
  }

  importProgress.textContent =
    `Import completed. Successful: ${successful}. Failed: ${failed}.`;

  if (errors.length) {
    console.error("Bulk import errors:", errors);

    await window.showToast(
      `${errors.length} student${errors.length === 1 ? "" : "s"} could not be imported. Review the console for row details.`,
      "warning",
      "Bulk import completed with warnings"
    );
  } else {
    await window.showToast(
      `${successful} student account${successful === 1 ? "" : "s"} imported successfully.`,
      "success",
      "Import complete"
    );
  }

  await loadStudents();

  importedStudents = [];
  bulkStudentFile.value = "";
  importPreview.textContent = "Import completed. Choose another file to continue.";

  isImporting = false;
  startImportButton.disabled = true;
  chooseFileButton.disabled = false;
  downloadTemplateButton.disabled = false;
});
