# FullStock

**FullStock: An AI-Powered Cloud-Based Inventory and Sales Management System Using React and Laravel**

FullStock is a React + Laravel application for managing products, sales, stock movements, suppliers, and customers. It follows the supplied high-fidelity design and includes a dashboard, reports, an inventory-aware assistant, and cloud deployment configuration.

## Features

- Responsive sign-in and dashboard UI based on the provided mockup.
- Product, supplier, and customer create, read, update, and delete workflows.
- Sales recording with stock deduction, customer totals, and an inventory movement entry.
- Stock-in adjustments with references and movement history.
- Low-stock badges, dashboard metrics, sales summaries, and category reporting.
- AI Assistant that ranks restock suggestions using 30-day sales, stock coverage, and reorder levels, including a simple two-week demand estimate. The assistant is explainable and uses the application’s own records; it does not place orders or change stock.
- Laravel Sanctum bearer-token authentication for the React client.
- Browser demo mode with local persistence when the Laravel API is offline.

## Run locally on Windows

You need PHP 8.2+, Composer, and Node.js 20.19+.

### 1. Start the Laravel API

Open PowerShell in `backend`:

```powershell
Copy-Item .env.example .env
New-Item -ItemType File -Force database\database.sqlite | Out-Null
composer install
php artisan key:generate
php artisan migrate --seed
php artisan serve --host=127.0.0.1 --port=8000
```

The local database uses SQLite. The first migration creates the tables and the seeder adds sample products, contacts, sales, and an inventory movement. The Assistant uses a local, explainable demand-ranking method and does not send questions or business records to an outside service.

#### Send password-reset links through Gmail

Sign-in uses the account email and password directly; no OTP is required. The backend uses the `log` mailer by default for local development. In that mode, reset emails are written to `backend/storage/logs/laravel.log`; they are not emailed. To deliver reset links to inboxes, create a Google App Password for the sending Gmail account, then set these values in `backend/.env` (keep the App Password private and do not commit `.env`):

```dotenv
MAIL_MAILER=smtp
MAIL_SCHEME=smtp
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USERNAME=your-sending-address@gmail.com
MAIL_PASSWORD=your-16-character-google-app-password
MAIL_FROM_ADDRESS=your-sending-address@gmail.com
MAIL_FROM_NAME="FullStock"
```

Use the Google App Password, not the account's regular password. After saving the values, run `php artisan config:clear` from `backend`, then restart `php artisan serve`. Password reset links expire after 60 minutes.

### 2. Start the React app

Open a second PowerShell window in `frontend`:

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

Open the Vite address printed in the terminal (usually `http://localhost:5173`). Demo accounts use password **password**:

- **admin@fullstock.test** — administrator access.
- **staff@fullstock.test** — staff access for sales and inventory tasks.

If you open the frontend without starting Laravel, use the same demo credentials. Changes will be saved in the browser until you clear its FullStock data.

## Cloud deployment

The root `render.yaml` defines a complete Render deployment: the React static site, Laravel Docker API, and PostgreSQL database in Singapore. Connect this repository to Render and create a Blueprint from the repository root. The Blueprint asks for `APP_KEY`; generate it locally with `cd backend; php artisan key:generate --show` and enter the result as a secret. Do not commit it.

The Blueprint uses Render's paid Starter web service and Basic-256mb PostgreSQL plan so the API stays online and the database does not expire like Render's 30-day free database. Check the current Render prices before creating the Blueprint. The service names determine the default `onrender.com` URLs in `render.yaml`; if Render assigns different URLs, update `APP_URL`, `FRONTEND_URL`, and the frontend's `VITE_API_URL` in the Render dashboard, then redeploy. Password reset mail is set to `log` until SMTP settings are configured.

The Laravel container runs database migrations at startup. Back up production data before changing database or deployment settings.

## Project layout

```text
FullStock/
├── backend/       Laravel API, authentication, database migrations, and seed data
├── frontend/      React/Vite application and responsive UI
└── README.md      Setup and deployment instructions
```
