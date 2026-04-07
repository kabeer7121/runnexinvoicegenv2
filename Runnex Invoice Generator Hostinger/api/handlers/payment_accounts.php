<?php
declare(strict_types=1);

function handle_payment_accounts(string $method, array $parts): void
{
    if ($method === 'GET' && count($parts) === 0) {
        require_login();
        $rows = db()->query(
            'SELECT id, label, details, display_order FROM payment_accounts ORDER BY display_order ASC, id ASC'
        )->fetchAll();
        json_response($rows);

        return;
    }

    if ($method === 'POST' && count($parts) === 0) {
        require_admin();
        $body = read_json_body();
        $label = trim((string) ($body['label'] ?? ''));
        $details = trim((string) ($body['details'] ?? ''));
        if ($label === '' || $details === '') {
            json_response(['error' => 'Label and payment details are required'], 400);
        }
        $order = (int) ($body['display_order'] ?? 0);
        db()->prepare(
            'INSERT INTO payment_accounts (label, details, display_order) VALUES (?,?,?)'
        )->execute([$label, $details, $order]);
        $id = (int) db()->lastInsertId();
        json_response(['id' => $id, 'success' => true], 201);

        return;
    }

    if ($method === 'PUT' && count($parts) === 1) {
        require_admin();
        $id = (int) $parts[0];
        if ($id <= 0) {
            json_response(['error' => 'Invalid id'], 400);
        }
        $body = read_json_body();
        $label = trim((string) ($body['label'] ?? ''));
        $details = trim((string) ($body['details'] ?? ''));
        if ($label === '' || $details === '') {
            json_response(['error' => 'Label and payment details are required'], 400);
        }
        $order = (int) ($body['display_order'] ?? 0);
        $st = db()->prepare(
            'UPDATE payment_accounts SET label=?, details=?, display_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
        );
        $st->execute([$label, $details, $order, $id]);
        if ($st->rowCount() === 0) {
            json_response(['error' => 'Not found'], 404);
        }
        json_response(['success' => true]);

        return;
    }

    if ($method === 'DELETE' && count($parts) === 1) {
        require_admin();
        $id = (int) $parts[0];
        if ($id <= 0) {
            json_response(['error' => 'Invalid id'], 400);
        }
        $st = db()->prepare('DELETE FROM payment_accounts WHERE id = ?');
        $st->execute([$id]);
        if ($st->rowCount() === 0) {
            json_response(['error' => 'Not found'], 404);
        }
        json_response(['success' => true]);

        return;
    }

    json_response(['error' => 'Not found'], 404);
}
