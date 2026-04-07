<?php
declare(strict_types=1);

function handle_agents(string $method, array $parts): void
{
    require_admin();
    $id = isset($parts[0]) && is_numeric($parts[0]) ? (int) $parts[0] : null;
    $sub = $parts[1] ?? null;

    if ($method === 'GET' && $id === null) {
        $sql = "SELECT u.id, u.username, u.full_name, u.email, u.is_active, u.created_at,
            GROUP_CONCAT(DISTINCT c.id ORDER BY c.id SEPARATOR ',') as client_ids,
            GROUP_CONCAT(DISTINCT c.company_name ORDER BY c.id SEPARATOR '||') as client_names
            FROM users u
            LEFT JOIN agent_client_assignments a ON a.agent_id = u.id
            LEFT JOIN clients c ON c.id = a.client_id AND c.is_active = 1
            WHERE u.role = 'agent'
            GROUP BY u.id, u.username, u.full_name, u.email, u.is_active, u.created_at
            ORDER BY u.full_name";
        $rows = db()->query($sql)->fetchAll();
        json_response($rows);
    }

    if ($method === 'POST' && $id === null) {
        $body = read_json_body();
        $username = trim((string) ($body['username'] ?? ''));
        $password = (string) ($body['password'] ?? '');
        if ($username === '' || $password === '') {
            json_response(['error' => 'Username and password required'], 400);
        }
        $ex = db()->prepare('SELECT id FROM users WHERE username = ?');
        $ex->execute([$username]);
        if ($ex->fetch()) {
            json_response(['error' => 'Username already taken'], 409);
        }
        $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
        $st = db()->prepare(
            'INSERT INTO users (username, password_hash, role, full_name, email) VALUES (?,?,?,?,?)'
        );
        $st->execute([
            $username,
            $hash,
            'agent',
            trim((string) ($body['full_name'] ?? '')),
            trim((string) ($body['email'] ?? '')),
        ]);
        json_response([
            'id' => (int) db()->lastInsertId(),
            'username' => $username,
            'full_name' => $body['full_name'] ?? '',
            'email' => $body['email'] ?? '',
        ], 201);
    }

    if ($method === 'PUT' && $id !== null && $sub === null) {
        $body = read_json_body();
        if (!empty($body['password'])) {
            $hash = password_hash((string) $body['password'], PASSWORD_BCRYPT, ['cost' => 12]);
            $st = db()->prepare(
                'UPDATE users SET full_name=?, email=?, password_hash=?, is_active=? WHERE id=?'
            );
            $st->execute([
                trim((string) ($body['full_name'] ?? '')),
                trim((string) ($body['email'] ?? '')),
                $hash,
                isset($body['is_active']) ? (int) $body['is_active'] : 1,
                $id,
            ]);
        } else {
            $st = db()->prepare('UPDATE users SET full_name=?, email=?, is_active=? WHERE id=?');
            $st->execute([
                trim((string) ($body['full_name'] ?? '')),
                trim((string) ($body['email'] ?? '')),
                isset($body['is_active']) ? (int) $body['is_active'] : 1,
                $id,
            ]);
        }
        json_response(['success' => true]);
    }

    if ($method === 'DELETE' && $id !== null && $sub === null) {
        db()->prepare('UPDATE users SET is_active = 0 WHERE id = ? AND role = ?')->execute([$id, 'agent']);
        json_response(['success' => true]);
    }

    if ($method === 'GET' && $id !== null && $sub === 'assignments') {
        $st = db()->prepare(
            'SELECT c.id, c.company_name, c.contact_name FROM clients c
             JOIN agent_client_assignments a ON a.client_id = c.id
             WHERE a.agent_id = ? AND c.is_active = 1'
        );
        $st->execute([$id]);
        json_response($st->fetchAll());
    }

    if ($method === 'POST' && $id !== null && $sub === 'assignments') {
        $body = read_json_body();
        $clientIds = $body['client_ids'] ?? [];
        db()->prepare('DELETE FROM agent_client_assignments WHERE agent_id = ?')->execute([$id]);
        if (is_array($clientIds) && count($clientIds) > 0) {
            $ins = db()->prepare('INSERT IGNORE INTO agent_client_assignments (agent_id, client_id) VALUES (?,?)');
            foreach ($clientIds as $cid) {
                $ins->execute([$id, (int) $cid]);
            }
        }
        json_response(['success' => true]);
    }

    json_response(['error' => 'Not found'], 404);
}
