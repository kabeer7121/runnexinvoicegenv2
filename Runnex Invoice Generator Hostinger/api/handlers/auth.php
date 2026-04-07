<?php
declare(strict_types=1);

function handle_auth(string $method, array $parts): void
{
    $action = $parts[0] ?? '';
    if ($method === 'POST' && $action === 'login') {
        $body = read_json_body();
        $username = trim((string) ($body['username'] ?? ''));
        $password = (string) ($body['password'] ?? '');
        if ($username === '' || $password === '') {
            json_response(['error' => 'Username and password required'], 400);
        }
        $st = db()->prepare('SELECT * FROM users WHERE username = ? AND is_active = 1');
        $st->execute([$username]);
        $user = $st->fetch();
        if (!$user || !password_verify($password, (string) $user['password_hash'])) {
            json_response(['error' => 'Invalid credentials'], 401);
        }
        $_SESSION['user_id'] = (int) $user['id'];
        $_SESSION['username'] = (string) $user['username'];
        $_SESSION['role'] = (string) $user['role'];
        $_SESSION['full_name'] = (string) ($user['full_name'] ?? '');
        json_response([
            'success' => true,
            'user' => [
                'id' => (int) $user['id'],
                'username' => $user['username'],
                'role' => $user['role'],
                'full_name' => $user['full_name'] ?? '',
            ],
        ]);
    }
    if ($method === 'POST' && $action === 'logout') {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
        }
        session_destroy();
        json_response(['success' => true]);
    }
    if ($method === 'GET' && $action === 'me') {
        if (empty($_SESSION['user_id'])) {
            json_response(['error' => 'Not authenticated'], 401);
        }
        json_response([
            'id' => (int) $_SESSION['user_id'],
            'username' => $_SESSION['username'],
            'role' => $_SESSION['role'],
            'full_name' => $_SESSION['full_name'] ?? '',
        ]);
    }
    if ($method === 'POST' && $action === 'change-password') {
        require_login();
        $body = read_json_body();
        $current = (string) ($body['current_password'] ?? '');
        $new = (string) ($body['new_password'] ?? '');
        if ($current === '' || $new === '') {
            json_response(['error' => 'Current and new password are required'], 400);
        }
        if (strlen($new) < 6) {
            json_response(['error' => 'New password must be at least 6 characters'], 400);
        }
        $st = db()->prepare('SELECT password_hash FROM users WHERE id = ? AND is_active = 1');
        $st->execute([(int) $_SESSION['user_id']]);
        $row = $st->fetch();
        if (!$row || !password_verify($current, (string) $row['password_hash'])) {
            json_response(['error' => 'Current password is incorrect'], 401);
        }
        $hash = password_hash($new, PASSWORD_BCRYPT, ['cost' => 12]);
        db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([$hash, (int) $_SESSION['user_id']]);
        json_response(['success' => true]);
    }
    json_response(['error' => 'Not found'], 404);
}
