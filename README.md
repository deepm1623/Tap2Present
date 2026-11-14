# Tap2Present

Tap2Present is a hybrid smart attendance portal for students, faculty, and administrators.

## Structure

- `index.html` is the preserved landing page.
- `student/`, `faculty/`, and `admin/` contain separate portal pages.
- `css/` contains shared, landing, authentication, and page-specific styles.
- `js/` contains the shared Firebase auth guard and page modules.
- `firebase-config.js` contains the existing Firebase project configuration.

## Authentication

Email/password authentication is handled by Firebase Authentication. Each signed-in user must have a matching `users/{uid}` Firestore document with the expected `role` and an `active` `status`. Role assignment remains a trusted administrative responsibility.

The attendance and reporting screens intentionally show empty states until the corresponding Firestore collections and campus reader integration are connected.

Run the site through a local web server so browser module imports and Firebase requests work correctly.
