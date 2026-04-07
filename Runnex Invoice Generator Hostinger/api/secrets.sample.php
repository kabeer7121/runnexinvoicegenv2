<?php
/**
 * Copy this file to secrets.php (same directory) on the server.
 * Never commit secrets.php.
 */
return [
    'db_host' => 'localhost',
    'db_name' => 'your_database_name',
    'db_user' => 'your_database_user',
    'db_pass' => 'your_database_password',

    /* Set to 1 on HTTPS (recommended). Use 0 only for local HTTP testing. */
    'cookie_secure' => 1,

    /* PDF upload parsing (rate cons): requires an Anthropic API key on the server. */
    'anthropic_api_key' => '',
    /* Optional: default is claude-sonnet-4-20250514 */
    'anthropic_model' => '',
    /* Set to '1' to disable Claude calls (upload will return a configuration error). */
    'anthropic_disabled' => '',

    /**
     * Optional but recommended for accurate fallback miles:
     * Google Maps Distance Matrix API key (driving distance).
     */
    'google_maps_api_key' => '',

    /**
     * Only if auto-detection fails: physical URL path to the API folder, no trailing slash.
     * Example: app lives at https://example.com/invoice/ → often '/invoice/api'
     */
    'api_path_prefix' => '',
];
