<?php
declare(strict_types=1);

function ensure_client_access(int $clientId): void
{
    if (is_admin()) {
        return;
    }
    $st = db()->prepare(
        'SELECT 1 as ok FROM agent_client_assignments WHERE agent_id = ? AND client_id = ?'
    );
    $st->execute([(int) $_SESSION['user_id'], $clientId]);
    if (!$st->fetch()) {
        json_response(['error' => 'Access denied for this client'], 403);
    }
}

/**
 * Optional invoice-number search from GET q (contains match). Returns SQL fragment and bound params.
 *
 * @return array{0: string, 1: array<int, string>}
 */
function invoice_list_number_search(): array
{
    $q = trim((string) ($_GET['q'] ?? ''));
    if ($q === '') {
        return ['', []];
    }
    if (function_exists('mb_strlen') && mb_strlen($q, 'UTF-8') > 120) {
        $q = mb_substr($q, 0, 120, 'UTF-8');
    } elseif (strlen($q) > 120) {
        $q = substr($q, 0, 120);
    }

    return [' AND d.invoice_number LIKE ? ', ['%' . $q . '%']];
}

function handle_invoices_client_report(int $clientId): void
{
    require_login();
    ensure_client_access($clientId);

    $from = trim((string) ($_GET['from'] ?? ''));
    $to = trim((string) ($_GET['to'] ?? ''));

    $st = db()->prepare('SELECT id, contact_name, company_name, email, phone FROM clients WHERE id = ?');
    $st->execute([$clientId]);
    $client = $st->fetch();
    if (!$client) {
        json_response(['error' => 'Client not found'], 404);
    }

    $sql = "SELECT d.id as draft_id, d.invoice_number, d.invoice_date, d.status, u.full_name as agent_name,
        r.row_order, r.row_data
        FROM invoice_drafts d
        LEFT JOIN users u ON u.id = d.agent_id
        LEFT JOIN invoice_rows r ON r.draft_id = d.id
        WHERE d.client_id = ?";
    $params = [$clientId];
    if ($from !== '') {
        $sql .= ' AND d.invoice_date >= ?';
        $params[] = $from;
    }
    if ($to !== '') {
        $sql .= ' AND d.invoice_date <= ?';
        $params[] = $to;
    }
    $sql .= ' ORDER BY d.invoice_date, d.id, r.row_order';
    $st = db()->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll();

    $grouped = [];
    foreach ($rows as $r) {
        $did = $r['draft_id'];
        if (!isset($grouped[$did])) {
            $grouped[$did] = [
                'draft_id' => $did,
                'invoice_number' => $r['invoice_number'],
                'invoice_date' => $r['invoice_date'],
                'status' => $r['status'],
                'agent_name' => $r['agent_name'] ?? '',
                'loads' => [],
            ];
        }
        if ($r['row_data'] !== null && $r['row_data'] !== '') {
            $parsed = json_decode((string) $r['row_data'], true);
            $grouped[$did]['loads'][] = is_array($parsed) ? $parsed : [];
        }
    }

    $loadRows = [];
    $weekMap = [];
    foreach ($grouped as $inv) {
        $ws = week_start_iso($inv['invoice_date'] ?? null);
        foreach ($inv['loads'] as $ld) {
            $m = metric_from_row_data($ld);
            $meta = report_row_meta_from_data($ld);
            $row = [
                'invoice_number' => $inv['invoice_number'] ?? '',
                'invoice_date' => $inv['invoice_date'] ?? '',
                'status' => $inv['status'] ?? '',
                'agent_name' => $inv['agent_name'] ?? '',
                'pickup_date' => $m['pickupDate'],
                'dropoff_date' => $m['dropoffDate'],
                'origin' => $m['origin'],
                'destination' => $m['destination'],
                'miles' => $m['miles'],
                'rate' => $m['rate'],
                'rpm' => $m['rpm'],
                'dispatcher_fee' => $m['dispatcherFee'],
                'invoice_amount' => $m['invoiceAmount'],
                'load_id' => $meta['load_id'],
                'broker_name' => $meta['broker_name'],
                'commodity' => $meta['commodity'],
                'weight' => $meta['weight'],
            ];
            $loadRows[] = $row;

            if ($ws === null) {
                continue;
            }
            if (!isset($weekMap[$ws])) {
                $weekMap[$ws] = [
                    'week_start' => $ws,
                    'loads' => 0,
                    'total_miles' => 0.0,
                    'total_rates' => 0.0,
                    'total_dispatcher_fee' => 0.0,
                    'invoice_amount' => 0.0,
                ];
            }
            $weekMap[$ws]['loads']++;
            $weekMap[$ws]['total_miles'] += $m['miles'];
            $weekMap[$ws]['total_rates'] += $m['rate'];
            $weekMap[$ws]['total_dispatcher_fee'] += $m['dispatcherFee'];
            $weekMap[$ws]['invoice_amount'] += $m['invoiceAmount'];
        }
    }

    $weekly = array_values($weekMap);
    usort($weekly, fn ($a, $b) => strcmp((string) $a['week_start'], (string) $b['week_start']));
    $weekly = array_map(function ($w) {
        $w['rpm'] = $w['total_miles'] > 0 ? $w['total_rates'] / $w['total_miles'] : 0;

        return $w;
    }, $weekly);

    json_response([
        'client' => $client,
        'filters' => ['from' => $from ?: null, 'to' => $to ?: null],
        'weekly' => $weekly,
        'rows' => $loadRows,
    ]);
}

function handle_invoices(string $method, array $parts): void
{
    // GET .../client/:clientId/report
    if (
        $method === 'GET'
        && ($parts[0] ?? '') === 'client'
        && isset($parts[1])
        && ($parts[2] ?? '') === 'report'
    ) {
        handle_invoices_client_report((int) $parts[1]);

        return;
    }

    // GET .../:id/export-data
    if (
        $method === 'GET'
        && count($parts) === 2
        && ($parts[1] ?? '') === 'export-data'
    ) {
        require_login();
        $id = (string) $parts[0];
        $st = db()->prepare('SELECT * FROM invoice_drafts WHERE id = ?');
        $st->execute([$id]);
        $draft = $st->fetch();
        if (!$draft) {
            json_response(['error' => 'Not found'], 404);
        }
        if (!is_admin() && (int) $draft['agent_id'] !== (int) $_SESSION['user_id']) {
            json_response(['error' => 'Access denied'], 403);
        }
        $rws = db()->prepare('SELECT * FROM invoice_rows WHERE draft_id = ? ORDER BY table_id, row_order');
        $rws->execute([$id]);
        $rows = $rws->fetchAll();
        foreach ($rows as &$r) {
            $r['row_data'] = json_decode((string) $r['row_data'], true) ?: [];
        }
        $client = null;
        if (!empty($draft['client_id'])) {
            $c = db()->prepare('SELECT * FROM clients WHERE id = ?');
            $c->execute([(int) $draft['client_id']]);
            $client = $c->fetch() ?: null;
        }
        $company = db()->query('SELECT * FROM company_settings LIMIT 1')->fetch();
        $paymentAccount = null;
        if (!empty($draft['payment_account_id'])) {
            $pa = db()->prepare('SELECT id, label, details FROM payment_accounts WHERE id = ?');
            $pa->execute([(int) $draft['payment_account_id']]);
            $paymentAccount = $pa->fetch() ?: null;
        }
        $tables = db()->query('SELECT * FROM table_templates ORDER BY display_order')->fetchAll();
        $columns = db()->query('SELECT * FROM column_templates ORDER BY display_order')->fetchAll();
        json_response([
            'draft' => $draft,
            'rows' => $rows,
            'client' => $client,
            'company' => $company ?: new stdClass(),
            'payment_account' => $paymentAccount,
            'tables' => $tables,
            'columns' => $columns,
        ]);

        return;
    }

    if ($method === 'GET' && count($parts) === 0) {
        require_login();
        [$searchSql, $searchParams] = invoice_list_number_search();
        $clientFilter = is_admin() ? parse_client_id($_GET['client_id'] ?? null) : null;
        if (is_admin() && $clientFilter) {
            $st = db()->prepare(
                "SELECT d.*, c.company_name as client_company, c.contact_name as client_name,
                u.full_name as agent_name, u.username as agent_username
                FROM invoice_drafts d
                LEFT JOIN clients c ON c.id = d.client_id
                LEFT JOIN users u ON u.id = d.agent_id
                WHERE d.client_id = ?{$searchSql} ORDER BY d.updated_at DESC"
            );
            $st->execute(array_merge([$clientFilter], $searchParams));
        } elseif (is_admin()) {
            $st = db()->prepare(
                "SELECT d.*, c.company_name as client_company, c.contact_name as client_name,
                u.full_name as agent_name, u.username as agent_username
                FROM invoice_drafts d
                LEFT JOIN clients c ON c.id = d.client_id
                LEFT JOIN users u ON u.id = d.agent_id
                WHERE 1=1{$searchSql} ORDER BY d.updated_at DESC"
            );
            $st->execute($searchParams);
        } else {
            $st = db()->prepare(
                "SELECT d.*, c.company_name as client_company, c.contact_name as client_name
                FROM invoice_drafts d
                LEFT JOIN clients c ON c.id = d.client_id
                WHERE d.agent_id = ?{$searchSql} ORDER BY d.updated_at DESC"
            );
            $st->execute(array_merge([(int) $_SESSION['user_id']], $searchParams));
        }
        json_response($st->fetchAll());

        return;
    }

    if ($method === 'GET' && count($parts) === 1) {
        require_login();
        $id = (string) $parts[0];
        $st = db()->prepare(
            "SELECT d.*, c.company_name as client_company, c.contact_name as client_name,
            u.full_name as agent_name, u.username as agent_username
            FROM invoice_drafts d
            LEFT JOIN clients c ON c.id = d.client_id
            LEFT JOIN users u ON u.id = d.agent_id
            WHERE d.id = ?"
        );
        $st->execute([$id]);
        $draft = $st->fetch();
        if (!$draft) {
            json_response(['error' => 'Draft not found'], 404);
        }
        if (!is_admin() && (int) $draft['agent_id'] !== (int) $_SESSION['user_id']) {
            json_response(['error' => 'Access denied'], 403);
        }
        $rws = db()->prepare('SELECT * FROM invoice_rows WHERE draft_id = ? ORDER BY table_id, row_order');
        $rws->execute([$id]);
        $pr = $rws->fetchAll();
        foreach ($pr as &$r) {
            $r['row_data'] = json_decode((string) $r['row_data'], true) ?: [];
        }
        $draft['rows'] = $pr;
        $draft['payment_account'] = null;
        if (!empty($draft['payment_account_id'])) {
            $pa = db()->prepare('SELECT id, label, details FROM payment_accounts WHERE id = ?');
            $pa->execute([(int) $draft['payment_account_id']]);
            $prow = $pa->fetch();
            if ($prow) {
                $draft['payment_account'] = $prow;
            }
        }
        json_response($draft);

        return;
    }

    if ($method === 'POST' && count($parts) === 0) {
        require_login();
        $body = read_json_body();
        $id = uuid_v4();
        $cid = parse_client_id($body['client_id'] ?? null);
        $invNum = trim((string) ($body['invoice_number'] ?? '')) ?: 'INV-' . time();
        $invDate = trim((string) ($body['invoice_date'] ?? '')) ?: date('Y-m-d');
        $notes = (string) ($body['notes'] ?? '');
        $payAid = resolve_payment_account_id($body['payment_account_id'] ?? null);
        try {
            db()->beginTransaction();
            $ins = db()->prepare(
                'INSERT INTO invoice_drafts (id, agent_id, client_id, payment_account_id, invoice_number, invoice_date, notes) VALUES (?,?,?,?,?,?,?)'
            );
            $ins->execute([$id, (int) $_SESSION['user_id'], $cid, $payAid, $invNum, $invDate, $notes]);
            if (!empty($body['rows']) && is_array($body['rows'])) {
                $ir = db()->prepare(
                    'INSERT INTO invoice_rows (draft_id, table_id, row_order, row_data) VALUES (?,?,?,?)'
                );
                foreach ($body['rows'] as $i => $row) {
                    $ir->execute([
                        $id,
                        $row['table_id'] ?? null,
                        $row['row_order'] ?? $i,
                        json_encode($row['row_data'] ?? [], JSON_UNESCAPED_UNICODE),
                    ]);
                }
            }
            db()->commit();
        } catch (Throwable $e) {
            db()->rollBack();
            json_response(['error' => $e->getMessage() ?: 'Could not save invoice'], 400);
        }
        json_response(['id' => $id, 'invoice_number' => $invNum], 201);

        return;
    }

    if ($method === 'PUT' && count($parts) === 1) {
        require_login();
        $id = (string) $parts[0];
        $body = read_json_body();
        $st = db()->prepare('SELECT * FROM invoice_drafts WHERE id = ?');
        $st->execute([$id]);
        $draft = $st->fetch();
        if (!$draft) {
            json_response(['error' => 'Draft not found'], 404);
        }
        if (!is_admin() && (int) $draft['agent_id'] !== (int) $_SESSION['user_id']) {
            json_response(['error' => 'Access denied'], 403);
        }
        $cid = array_key_exists('client_id', $body)
            ? parse_client_id($body['client_id'])
            : parse_client_id($draft['client_id'] ?? null);
        $payAid = array_key_exists('payment_account_id', $body)
            ? resolve_payment_account_id($body['payment_account_id'])
            : resolve_payment_account_id($draft['payment_account_id'] ?? null);
        try {
            db()->beginTransaction();
            db()->prepare(
                'UPDATE invoice_drafts SET client_id=?, payment_account_id=?, invoice_number=?, invoice_date=?, notes=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
            )->execute([
                $cid,
                $payAid,
                trim((string) ($body['invoice_number'] ?? $draft['invoice_number'])),
                trim((string) ($body['invoice_date'] ?? $draft['invoice_date'])),
                array_key_exists('notes', $body) ? (string) $body['notes'] : (string) $draft['notes'],
                trim((string) ($body['status'] ?? $draft['status'])),
                $id,
            ]);
            if (isset($body['rows']) && is_array($body['rows'])) {
                db()->prepare('DELETE FROM invoice_rows WHERE draft_id = ?')->execute([$id]);
                $ir = db()->prepare(
                    'INSERT INTO invoice_rows (draft_id, table_id, row_order, row_data) VALUES (?,?,?,?)'
                );
                foreach ($body['rows'] as $i => $row) {
                    $ir->execute([
                        $id,
                        $row['table_id'] ?? null,
                        $row['row_order'] ?? $i,
                        json_encode($row['row_data'] ?? [], JSON_UNESCAPED_UNICODE),
                    ]);
                }
            }
            db()->commit();
        } catch (Throwable $e) {
            db()->rollBack();
            json_response(['error' => $e->getMessage() ?: 'Could not update invoice'], 400);
        }
        json_response(['success' => true]);

        return;
    }

    if ($method === 'DELETE' && count($parts) === 1) {
        require_login();
        $id = (string) $parts[0];
        $st = db()->prepare('SELECT * FROM invoice_drafts WHERE id = ?');
        $st->execute([$id]);
        $draft = $st->fetch();
        if (!$draft) {
            json_response(['error' => 'Not found'], 404);
        }
        if (!is_admin() && (int) $draft['agent_id'] !== (int) $_SESSION['user_id']) {
            json_response(['error' => 'Access denied'], 403);
        }
        db()->prepare('DELETE FROM invoice_drafts WHERE id = ?')->execute([$id]);
        json_response(['success' => true]);

        return;
    }

    json_response(['error' => 'Not found'], 404);
}
