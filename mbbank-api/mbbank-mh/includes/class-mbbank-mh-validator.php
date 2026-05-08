<?php

/**
 * Input validation functionality for the plugin.
 *
 * @link       https://dominhhai.com/
 * @since      1.0.0
 *
 * @package    Mbbank_Mh
 * @subpackage Mbbank_Mh/includes
 */

/**
 * Input validator class.
 *
 * Provides comprehensive input validation and sanitization.
 *
 * @package    Mbbank_Mh
 * @subpackage Mbbank_Mh/includes
 * @author     MH Developer <dev@example.com>
 */
class Mbbank_Mh_Validator {

    /**
     * Validate and sanitize order ID
     *
     * @param mixed $id The order ID to validate
     * @return int Validated order ID
     * @throws Exception If validation fails
     */
    public static function validate_order_id($id) {
        $id = absint($id);
        
        if ($id <= 0) {
            throw new Exception('Invalid order ID: must be positive integer');
        }
        
        $order = wc_get_order($id);
        if (!$order || !is_a($order, 'WC_Order')) {
            throw new Exception('Order not found: ' . $id);
        }
        
        return $id;
    }

    /**
     * Validate transaction data structure
     *
     * @param array $transaction Transaction data
     * @return array Validated and sanitized transaction data
     * @throws Exception If validation fails
     */
    public static function validate_transaction_data($transaction) {
        if (!is_array($transaction)) {
            throw new Exception('Transaction data must be an array');
        }

        $required_fields = ['transactionNumber', 'amount', 'type'];
        foreach ($required_fields as $field) {
            if (!isset($transaction[$field])) {
                throw new Exception('Missing required field: ' . $field);
            }
        }

        // Sanitize and validate transaction number
        $tranId = sanitize_text_field($transaction['transactionNumber']);
        if (empty($tranId) || strlen($tranId) > 50) {
            throw new Exception('Invalid transaction ID length');
        }

        // Validate amount
        $amount = floatval($transaction['amount']);
        if ($amount <= 0 || $amount > 999999999) {
            throw new Exception('Invalid transaction amount: ' . $amount);
        }

        // Validate type
        $type = strtoupper(sanitize_text_field($transaction['type']));
        if (!in_array($type, ['IN', 'OUT'])) {
            throw new Exception('Invalid transaction type: ' . $type);
        }

        return [
            'transactionNumber' => $tranId,
            'amount' => $amount,
            'type' => $type,
            'description' => isset($transaction['description']) ? sanitize_text_field($transaction['description']) : '',
            'partnerName' => isset($transaction['partnerName']) ? sanitize_text_field($transaction['partnerName']) : '',
            'partnerId' => isset($transaction['partnerId']) ? sanitize_text_field($transaction['partnerId']) : '',
            'ownerName' => isset($transaction['ownerName']) ? sanitize_text_field($transaction['ownerName']) : '',
            'ownerNumber' => isset($transaction['ownerNumber']) ? sanitize_text_field($transaction['ownerNumber']) : '',
        ];
    }

    /**
     * Validate nonce for AJAX requests
     *
     * @param string $nonce The nonce to validate
     * @param string $action The action name
     * @return bool True if valid
     * @throws Exception If nonce is invalid
     */
    public static function validate_nonce($nonce, $action) {
        if (!wp_verify_nonce($nonce, $action)) {
            throw new Exception('Invalid security token');
        }
        return true;
    }

    /**
     * Validate admin capability
     *
     * @return bool True if user has admin capability
     * @throws Exception If user doesn't have permission
     */
    public static function validate_admin() {
        if (!current_user_can('manage_options')) {
            throw new Exception('Insufficient permissions');
        }
        return true;
    }

    /**
     * Validate and sanitize API endpoint
     *
     * @param string $endpoint The API endpoint URL
     * @return string Validated endpoint
     * @throws Exception If validation fails
     */
    public static function validate_api_endpoint($endpoint) {
        $endpoint = trim($endpoint);
        
        if (empty($endpoint)) {
            throw new Exception('API endpoint cannot be empty');
        }
        
        if (!filter_var($endpoint, FILTER_VALIDATE_URL)) {
            throw new Exception('Invalid API endpoint URL');
        }
        
        // Must be HTTPS in production
        if (!defined('WP_DEBUG') || !WP_DEBUG) {
            if (strpos($endpoint, 'https://') !== 0) {
                throw new Exception('API endpoint must use HTTPS in production');
            }
        }
        
        return esc_url_raw($endpoint);
    }

    /**
     * Validate access token
     *
     * @param string $token The access token
     * @return string Validated token
     * @throws Exception If validation fails
     */
    public static function validate_access_token($token) {
        $token = trim($token);
        
        if (empty($token)) {
            throw new Exception('Access token cannot be empty');
        }
        
        if (strlen($token) < 10) {
            throw new Exception('Access token too short');
        }
        
        if (strlen($token) > 500) {
            throw new Exception('Access token too long');
        }
        
        // Basic format validation - alphanumeric and some special chars
        if (!preg_match('/^[a-zA-Z0-9_\-\.]+$/', $token)) {
            throw new Exception('Invalid access token format');
        }
        
        return sanitize_text_field($token);
    }

    /**
     * Validate amount
     *
     * @param mixed $amount The amount to validate
     * @return float Validated amount
     * @throws Exception If validation fails
     */
    public static function validate_amount($amount) {
        $amount = floatval($amount);
        
        if ($amount < 0) {
            throw new Exception('Amount cannot be negative');
        }
        
        if ($amount > 999999999) {
            throw new Exception('Amount too large');
        }
        
        return $amount;
    }

    /**
     * Validate currency rate
     *
     * @param mixed $rate The currency rate
     * @return float Validated rate
     * @throws Exception If validation fails
     */
    public static function validate_currency_rate($rate) {
        $rate = floatval($rate);
        
        if ($rate <= 0) {
            throw new Exception('Currency rate must be positive');
        }
        
        if ($rate > 1000000) {
            throw new Exception('Currency rate too large');
        }
        
        return $rate;
    }

    /**
     * Sanitize settings array
     *
     * @param array $settings Settings array
     * @return array Sanitized settings
     */
    public static function sanitize_settings($settings) {
        if (!is_array($settings)) {
            return [];
        }

        $sanitized = [];

        $acc = (isset($settings['account']) && is_array($settings['account'])) ? $settings['account'] : [];
        $sanitized['account'] = [
            'number' => isset($acc['number']) ? sanitize_text_field($acc['number']) : '',
            'name' => isset($acc['name']) ? sanitize_text_field($acc['name']) : '',
            'bin' => isset($acc['bin']) ? sanitize_text_field($acc['bin']) : '970422',
        ];

        // Prefix and suffix
        $sanitized['prefix'] = isset($settings['prefix']) ? sanitize_text_field($settings['prefix']) : 'DH';
        $sanitized['subfix'] = isset($settings['subfix']) ? sanitize_text_field($settings['subfix']) : '';

        // Order status
        $valid_statuses = ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'];
        $sanitized['order_status'] = isset($settings['order_status']) && in_array($settings['order_status'], $valid_statuses, true)
            ? $settings['order_status']
            : 'processing';
        $sanitized['create_order_status'] = isset($settings['create_order_status']) && in_array($settings['create_order_status'], $valid_statuses, true)
            ? $settings['create_order_status']
            : 'pending';

        // Currency rate
        try {
            $sanitized['currency_rate'] = self::validate_currency_rate($settings['currency_rate'] ?? 1);
        } catch (Exception $e) {
            $sanitized['currency_rate'] = 1;
        }

        // QR template
        $sanitized['qr_template'] = isset($settings['qr_template']) ? sanitize_text_field($settings['qr_template']) : 'https://api.vietqr.io/{BIN}/{ACC}/{AMT}/{NOTE}/qr_only.jpg';

        $api = (isset($settings['api']) && is_array($settings['api'])) ? $settings['api'] : [];
        $sanitized['api'] = [
            'endpoint' => isset($api['endpoint']) ? esc_url_raw($api['endpoint']) : '',
        ];

        $notify = (isset($settings['notify']) && is_array($settings['notify'])) ? $settings['notify'] : [];
        $sanitized['notify'] = [
            'payment_gateway_label' => isset($notify['payment_gateway_label']) ? sanitize_text_field($notify['payment_gateway_label']) : '',
            'method_description' => isset($notify['method_description']) ? wp_kses_post($notify['method_description']) : '',
            'order_completed' => isset($notify['order_completed']) ? wp_kses_post($notify['order_completed']) : '',
        ];

        $sanitized['debug'] = [
            'enabled' => !empty($settings['debug']['enabled']),
        ];

        $valid_grace = [1800, 3600, 7200, 14400, 28800, 86400, 259200, 604800];
        $grace = isset($settings['auto_reactivate']['grace_period']) ? intval($settings['auto_reactivate']['grace_period']) : 86400;
        if (!in_array($grace, $valid_grace, true)) {
            $grace = 86400;
        }
        $sanitized['auto_reactivate'] = [
            'enabled' => !empty($settings['auto_reactivate']['enabled']),
            'grace_period' => $grace,
        ];

        $valid_timeouts = [900, 1800, 3600, 7200, 0];
        $timeout = isset($settings['auto_cancel']['timeout']) ? intval($settings['auto_cancel']['timeout']) : 3600;
        if (!in_array($timeout, $valid_timeouts, true)) {
            $timeout = 3600;
        }
        $sanitized['auto_cancel'] = [
            'timeout' => $timeout,
        ];

        // Reload after completed
        $sanitized['reload_after_completed'] = !empty($settings['reload_after_completed']);

        // URL redirect
        $sanitized['url_redirect'] = isset($settings['url_redirect']) ? esc_url_raw($settings['url_redirect']) : '';

        return $sanitized;
    }
}

