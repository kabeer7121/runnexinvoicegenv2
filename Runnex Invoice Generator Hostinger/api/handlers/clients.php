<?php
declare(strict_types=1);

function handle_clients(string $method, array $parts): void
{
    $id = isset($parts[0]) && $parts[0] !== '' ? (int) $parts[0] : null;

    if ($method === 'GET' && $id === null) {
        require_login();
        if (is_admin()) {
            $rows = db()->query('SELECT * FROM clients WHERE is_active = 1 ORDER BY company_name')->fetchAll();
        } else {
            $st = db()->prepare(
                'SELECT c.* FROM clients c
                 JOIN agent_client_assignments a ON a.client_id = c.id
                 WHERE a.agent_id = ? AND c.is_active = 1 ORDER BY c.company_name'
            );
            $st->execute([(int) $_SESSION['user_id']]);
            $rows = $st->fetchAll();
        }
        json_response($rows);
    }

    if ($method === 'GET' && $id !== null) {
        require_login();
        $st = db()->prepare('SELECT * FROM clients WHERE id = ? AND is_active = 1');
        $st->execute([$id]);
        $row = $st->fetch();
        if (!$row) {
            json_response(['error' => 'Client not found'], 404);
        }
        json_response($row);
    }

    if ($method === 'POST' && $id === null) {
        require_admin();
        $body = read_json_body();
        $cn = trim((string) ($body['contact_name'] ?? ''));
        $comp = trim((string) ($body['company_name'] ?? ''));
        if ($cn === '' || $comp === '') {
            json_response(['error' => 'Contact name and company name required'], 400);
        }
        $st = db()->prepare(
            'INSERT INTO clients (contact_name, company_name, email, phone) VALUES (?,?,?,?)'
        );
        $st->execute([
            $cn,
            $comp,
            trim((string) ($body['email'] ?? '')),
            trim((string) ($body['phone'] ?? '')),
        ]);
        $newId = (int) db()->lastInsertId();
        json_response([
            'id' => $newId,
            'contact_name' => $cn,
            'company_name' => $comp,
            'email' => $body['email'] ?? '',
            'phone' => $body['phone'] ?? '',
        ], 201);
    }

    if ($method === 'PUT' && $id !== null) {
        require_admin();
        $body = read_json_body();
        $st = db()->prepare(
            'UPDATE clients SET contact_name=?, company_name=?, email=?, phone=? WHERE id=?'
        );
        $st->execute([
            trim((string) ($body['contact_name'] ?? '')),
            trim((string) ($body['company_name'] ?? '')),
            trim((string) ($body['email'] ?? '')),
            trim((string) ($body['phone'] ?? '')),
            $id,
        ]);
        json_response(['success' => true]);
    }

    if ($method === 'DELETE' && $id !== null) {
        require_admin();
        db()->prepare('UPDATE clients SET is_active = 0 WHERE id = ?')->execute([$id]);
        json_response(['success' => true]);
    }

    json_response(['error' => 'Not found'], 404);
}
