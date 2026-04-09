# Runnex Invoice Generator v2

Runnex Invoice Generator is a full-stack web app for logistics invoicing.  
It helps agents upload RateCon PDFs, auto-extract load details with AI, build invoice rows quickly, save drafts, and export polished PDF invoices.

## Features

- Role-based access with `admin` and `agent` users
- Secure login/logout with PHP session authentication
- Client management (add/edit/list clients)
- Agent management and client assignment
- Dynamic invoice table templates and column templates
- Upload one or many RateCon PDFs at once
- AI-powered extraction of load data (origin, destination, miles, rate, load id, broker, etc.)
- Date-aware batch parsing and row-ready extraction workflow
- Automatic RPM calculations from rate and miles
- Draft invoice save/load/delete workflow
- Branded PDF invoice export with totals and summary
- Payment account block in PDF (wire/payment instructions)
- Client-level reporting with CSV export
- Theme support and responsive UI for day-to-day operations

## Tech Stack

### Frontend
- HTML
- CSS
- Vanilla JavaScript
- `jsPDF` + `autoTable` for PDF generation

### Backend
- PHP (modular API handlers)
- Session-based auth
- Custom router in `api/index.php`

### Database
- MySQL / MariaDB
- SQL schema in `database-import.sql`

### AI Integration
- Anthropic Claude Messages API for PDF extraction
- Optional maps/routing support for miles estimation fallback

## Project Structure

```text
Runnex Invoice Generator Hostinger/
  admin.html
  agent.html
  login.html
  index.html
  css/
    main.css
  js/
    app.js
    agent.js
    invoice-pdf-export.js
  api/
    index.php
    bootstrap.php
    secrets.sample.php
    handlers/
      auth.php
      clients.php
      agents.php
      templates.php
      company.php
      payment_accounts.php
      invoices.php
      upload.php
    lib/
      helpers.php
      claude_geo.php
  database-import.sql
  database-migration-payment-accounts.sql
```

## Core Workflow

1. User logs in as admin or agent.
2. Agent selects a client and uploads RateCon PDF(s).
3. Backend sends PDF content to Claude for structured extraction.
4. Extracted fields are shown and inserted into invoice rows.
5. Agent edits rows as needed and saves invoice draft.
6. Invoice is exported as a styled PDF.
7. Invoice status can move from draft to finalized.

## Main API Resources

- `/api/auth` - authentication and password change
- `/api/clients` - client CRUD
- `/api/agents` - agent management and assignments
- `/api/templates` - invoice table/column templates
- `/api/company` - company profile + branding data
- `/api/payment-accounts` - payment instruction accounts
- `/api/invoices` - draft CRUD, reporting, export data
- `/api/upload` - PDF parse and logo upload

## Database Tables

- `users`
- `company_settings`
- `clients`
- `agent_client_assignments`
- `table_templates`
- `column_templates`
- `payment_accounts`
- `invoice_drafts`
- `invoice_rows`
- `uploads`

## Setup

### 1) Prepare database

- Create a MySQL database.
- Import `Runnex Invoice Generator Hostinger/database-import.sql`.
- If needed, run `database-migration-payment-accounts.sql`.

### 2) Configure backend secrets

- Copy:
  - `Runnex Invoice Generator Hostinger/api/secrets.sample.php`
  - to `Runnex Invoice Generator Hostinger/api/secrets.php`
- Set database credentials in `secrets.php`.
- Add `anthropic_api_key` for PDF extraction.
- Optional: add `google_maps_api_key` for improved miles estimation.

### 3) Deploy

- Upload project files to your PHP hosting environment.
- Ensure API path and web server routing point correctly to `/api`.
- Ensure writable folders exist (`uploads`, logos/assets path as used by app).
- Open `login.html` and sign in.

## Default Seed Account

Schema seed includes one initial admin account:

- Username: `admin`
- Password: `admin123`

Change this password immediately after first login.

## PDF Export Details

Generated invoice PDFs include:
- company branding and logo
- invoice metadata (number/date/currency)
- bill-to section
- load detail tables with subtotal row
- summary cards (loads, miles, rates, RPM, dispatcher fee)
- payment instructions block (if selected)

## Reporting

Client reports support:
- weekly summary metrics
- load-level rows
- CSV export for downstream analysis

## Security Notes

- Keep `api/secrets.php` private.
- Do not commit real API keys or production DB credentials.
- Use HTTPS and secure cookie settings in production.
- Rotate admin credentials and API keys periodically.

## Troubleshooting

- **PDF parse fails**: verify `anthropic_api_key` and API availability.
- **No invoices shown**: check DB connection and `/api/invoices` responses.
- **Payment account block missing**: verify payment accounts exist and one is selected.
- **Logo not showing**: confirm upload path and file permissions.

## Future Improvements

- Automated tests for API handlers and UI flows
- Better observability/logging
- Rate-limit + retry strategy for external APIs
- Schema migration/version tooling
- CI/CD pipeline and environment profiles
