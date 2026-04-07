<?php
declare(strict_types=1);

function handle_company(string $method, array $parts): void
{
    if ($method === 'GET' && count($parts) === 0) {
        require_login();
        $row = db()->query('SELECT * FROM company_settings ORDER BY id DESC LIMIT 1')->fetch();
        json_response($row ?: new stdClass());
    }

    if ($method === 'PUT' && count($parts) === 0) {
        require_admin();
        $body = read_json_body();
        $ex = db()->query('SELECT id FROM company_settings LIMIT 1')->fetch();
        if ($ex) {
            db()->prepare(
                'UPDATE company_settings SET company_name=?, email=?, phone=?, address=?, currency=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
            )->execute([
                (string) ($body['company_name'] ?? ''),
                (string) ($body['email'] ?? ''),
                (string) ($body['phone'] ?? ''),
                (string) ($body['address'] ?? ''),
                (string) ($body['currency'] ?? 'USD'),
                $ex['id'],
            ]);
        } else {
            db()->prepare(
                'INSERT INTO company_settings (company_name, email, phone, address, currency) VALUES (?,?,?,?,?)'
            )->execute([
                (string) ($body['company_name'] ?? ''),
                (string) ($body['email'] ?? ''),
                (string) ($body['phone'] ?? ''),
                (string) ($body['address'] ?? ''),
                (string) ($body['currency'] ?? 'USD'),
            ]);
        }
        json_response(['success' => true]);
    }

    if ($method === 'DELETE' && (($parts[0] ?? '') === 'logo')) {
        require_admin();
        $row = db()->query('SELECT id, logo_path FROM company_settings LIMIT 1')->fetch();
        if ($row && !empty($row['logo_path'])) {
            $rel = ltrim((string) $row['logo_path'], '/');
            if (str_starts_with($rel, 'assets/logos/') && !str_contains($rel, '..')) {
                $abs = $GLOBALS['public_root'] . '/' . $rel;
                if (is_file($abs)) {
                    @unlink($abs);
                }
            }
            db()->prepare(
                'UPDATE company_settings SET logo_path = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
            )->execute([$row['id']]);
        }
        json_response(['success' => true]);
    }

    json_response(['error' => 'Not found'], 404);
}
