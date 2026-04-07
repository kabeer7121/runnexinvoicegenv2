<?php
declare(strict_types=1);

function norm_col_type(mixed $t): string
{
    $x = strtolower((string) ($t ?? 'text'));
    if ($x === 'mixed') {
        return 'text';
    }
    return $x === 'number' ? 'number' : 'text';
}

function handle_templates(string $method, array $parts): void
{
    $head = $parts[0] ?? '';
    $rid = isset($parts[1]) ? (int) $parts[1] : null;

    if ($method === 'GET' && $head === 'tables' && $rid === null) {
        require_login();
        $tables = db()->query('SELECT * FROM table_templates ORDER BY display_order, id')->fetchAll();
        $columns = db()->query('SELECT * FROM column_templates ORDER BY display_order, id')->fetchAll();
        $out = [];
        foreach ($tables as $t) {
            $t['columns'] = array_values(array_filter($columns, fn ($c) => (int) $c['table_id'] === (int) $t['id']));
            $out[] = $t;
        }
        json_response($out);
    }

    if ($method === 'POST' && $head === 'tables' && $rid === null) {
        require_admin();
        $body = read_json_body();
        $name = trim((string) ($body['name'] ?? ''));
        if ($name === '') {
            json_response(['error' => 'Table name required'], 400);
        }
        $mo = (int) (db()->query('SELECT COALESCE(MAX(display_order),0) as m FROM table_templates')->fetch()['m'] ?? 0);
        $st = db()->prepare('INSERT INTO table_templates (name, display_order) VALUES (?,?)');
        $st->execute([$name, $mo + 1]);
        json_response(['id' => (int) db()->lastInsertId(), 'name' => $name], 201);
    }

    if ($method === 'PUT' && $head === 'tables' && $rid !== null) {
        require_admin();
        $body = read_json_body();
        db()->prepare('UPDATE table_templates SET name = ? WHERE id = ?')->execute([
            trim((string) ($body['name'] ?? '')),
            $rid,
        ]);
        json_response(['success' => true]);
    }

    if ($method === 'DELETE' && $head === 'tables' && $rid !== null) {
        require_admin();
        db()->prepare('DELETE FROM table_templates WHERE id = ?')->execute([$rid]);
        json_response(['success' => true]);
    }

    if ($method === 'POST' && $head === 'columns' && $rid === null) {
        require_admin();
        $body = read_json_body();
        $tid = (int) ($body['table_id'] ?? 0);
        $name = trim((string) ($body['name'] ?? ''));
        $label = trim((string) ($body['label'] ?? ''));
        if (!$tid || $name === '' || $label === '') {
            json_response(['error' => 'table_id, name, label required'], 400);
        }
        $st = db()->prepare(
            'SELECT COALESCE(MAX(display_order),0) as m FROM column_templates WHERE table_id = ?'
        );
        $st->execute([$tid]);
        $mo = (int) ($st->fetch()['m'] ?? 0);
        $ct = norm_col_type($body['col_type'] ?? 'text');
        $ins = db()->prepare(
            'INSERT INTO column_templates (table_id, name, label, col_type, display_order) VALUES (?,?,?,?,?)'
        );
        $ins->execute([$tid, $name, $label, $ct, $mo + 1]);
        json_response([
            'id' => (int) db()->lastInsertId(),
            'table_id' => $tid,
            'name' => $name,
            'label' => $label,
            'col_type' => $ct,
        ], 201);
    }

    if ($method === 'PUT' && $head === 'columns' && $rid !== null) {
        require_admin();
        $body = read_json_body();
        $st = db()->prepare('SELECT * FROM column_templates WHERE id = ?');
        $st->execute([$rid]);
        $col = $st->fetch();
        if (!$col) {
            json_response(['error' => 'Column not found'], 404);
        }
        $safeName = !empty($body['name'])
            ? preg_replace('/[^a-z0-9_]/', '', strtolower(str_replace(' ', '_', (string) $body['name'])))
            : $col['name'];
        $safeLabel = $body['label'] !== null && $body['label'] !== '' ? (string) $body['label'] : $col['label'];
        $safeType = norm_col_type($body['col_type'] ?? $col['col_type']);
        $ord = isset($body['display_order']) && is_numeric($body['display_order'])
            ? (int) $body['display_order']
            : (int) $col['display_order'];
        db()->prepare(
            'UPDATE column_templates SET name=?, label=?, col_type=?, display_order=? WHERE id=?'
        )->execute([$safeName, $safeLabel, $safeType, $ord, $rid]);
        json_response(['success' => true]);
    }

    if ($method === 'DELETE' && $head === 'columns' && $rid !== null) {
        require_admin();
        db()->prepare('DELETE FROM column_templates WHERE id = ?')->execute([$rid]);
        json_response(['success' => true]);
    }

    json_response(['error' => 'Not found'], 404);
}
