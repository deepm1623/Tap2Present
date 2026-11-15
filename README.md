# Tap2Present

Tap2Present is a hybrid smart attendance portal for students, faculty, and administrators.

## Structure

- `index.html` is the landing page.
- `student/`, `faculty/`, and `admin/` contain the active portal pages.
- `css/` contains shared, landing, authentication, and page-specific styles.
- `js/` contains the shared Firebase auth guard and portal modules.
- `components/global-popups.html` and `js/Common/popups.js` provide shared dialogs and toasts.
- `firebase-config.js` contains the existing Firebase project configuration.

## Authentication

Email/password authentication is handled by Firebase Authentication. Each signed-in user must have a matching `users/{uid}` Firestore document with the expected `role` and an `active` `status`. Role assignment remains a trusted administrative responsibility.

The faculty attendance page reads NDEF text records in the `TAP2P:STUDENT_ID` format, verifies the student profile, and writes a present record to the `attendance` collection. Student dashboards and history pages read those records. Class/session management, absent calculation, and reporting remain prototype roadmap items.

Run the site through a local web server so browser module imports, the shared popup component, and Firebase requests work correctly. NFC scanning also requires HTTPS and a supported Android browser.
