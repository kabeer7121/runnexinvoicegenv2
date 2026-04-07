<?php
/**
 * Server secrets/config (do not commit in git repos).
 */
return [
    'db_host' => 'localhost',
    'db_name' => 'u863578529_Invoice',
    'db_user' => 'u863578529_Runnex',
    'db_pass' => 'RunnexInvoice@123',

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
    'google_maps_api_key' => 'AIzaSyAOVYRIgupAurZup5y1PRh8Ismb1A3lLao',

    /**
     * Only if auto-detection fails: physical URL path to the API folder, no trailing slash.
     * Example: app lives at https://example.com/invoice/ -> often '/invoice/api'
     */
    'api_path_prefix' => '',
];
