# QueuePilot

QueuePilot is a React app with an Express and PostgreSQL backend for hospital, patient, doctor, lab, and admin queue workflows.

## Setup

1. Create a PostgreSQL database:

   ```sql
   CREATE DATABASE hospital_queue;
   ```

2. Copy `.env.example` to `.env` and update `DATABASE_URL`.

3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

The server creates the tables automatically on startup. The default admin login is `admin` / `admin123` unless you change `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env`.

## Pages

- `#/login` for all role logins.
- `#/register` for patient and hospital registration.
- `#/patient` for patient token booking.
- `#/hospital` for hospital reception to create doctor and lab accounts.
- `#/doctor` for doctor queue actions.
- `#/lab` for lab queue actions.
- `#/admin` for full database viewing.
- `#/queues` for the public queue dashboard.

## Roles

- Patients can register, log in, choose a hospital, and enter a doctor or lab queue.
- Hospitals act as reception/admin for their own hospital and create doctor and lab logins.
- Doctors can call the next patient, send the current patient to the lab queue, finish the patient, and take or end breaks.
- Labs can process multiple active patients up to the hospital-configured capacity.
- Admin can view all main database tables from the app.
