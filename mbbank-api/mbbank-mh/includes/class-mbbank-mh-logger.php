<?php

/**
 * Centralized logging functionality for the plugin.
 *
 * @link       https://dominhhai.com/
 * @since      1.0.0
 *
 * @package    Mbbank_Mh
 * @subpackage Mbbank_Mh/includes
 */

/**
 * Centralized logger class.
 *
 * Provides structured logging with context and error codes.
 *
 * @package    Mbbank_Mh
 * @subpackage Mbbank_Mh/includes
 * @author     MH Developer <dev@example.com>
 */
class Mbbank_Mh_Logger {

    /**
     * Log levels
     */
    const LEVEL_ERROR = 'ERROR';
    const LEVEL_WARNING = 'WARNING';
    const LEVEL_INFO = 'INFO';
    const LEVEL_DEBUG = 'DEBUG';

    /**
     * Error codes for tracking
     */
    const ERROR_API_CALL = 'API_CALL_ERROR';
    const ERROR_DB_QUERY = 'DB_QUERY_ERROR';
    const ERROR_PAYMENT_PROCESSING = 'PAYMENT_PROCESSING_ERROR';
    const ERROR_LOCK_ACQUISITION = 'LOCK_ACQUISITION_ERROR';
    const ERROR_VALIDATION = 'VALIDATION_ERROR';

    /**
     * Log an error message
     *
     * @param string $context The context of the error (e.g., 'payment_processing', 'api_call')
     * @param string $message The error message
     * @param array $data Additional data to log
     * @param string $error_code Optional error code for tracking
     * @return void
     */
    public static function error($context, $message, $data = [], $error_code = '') {
        self::log(self::LEVEL_ERROR, $context, $message, $data, $error_code);
    }

    /**
     * Log a warning message
     *
     * @param string $context The context
     * @param string $message The warning message
     * @param array $data Additional data
     * @return void
     */
    public static function warning($context, $message, $data = []) {
        self::log(self::LEVEL_WARNING, $context, $message, $data);
    }

    /**
     * Log an info message
     *
     * @param string $context The context
     * @param string $message The info message
     * @param array $data Additional data
     * @return void
     */
    public static function info($context, $message, $data = []) {
        self::log(self::LEVEL_INFO, $context, $message, $data);
    }

    /**
     * Log a debug message (only when WP_DEBUG or MBB_DEBUG is enabled)
     *
     * @param string $context The context
     * @param string $message The debug message
     * @param array $data Additional data
     * @return void
     */
    public static function debug($context, $message, $data = []) {
        if (defined('WP_DEBUG') && WP_DEBUG || defined('MBB_DEBUG') && MBB_DEBUG) {
            self::log(self::LEVEL_DEBUG, $context, $message, $data);
        }
    }

    /**
     * Main logging method
     *
     * @param string $level Log level
     * @param string $context Context of the log
     * @param string $message Log message
     * @param array $data Additional data
     * @param string $error_code Optional error code
     * @return void
     */
    private static function log($level, $context, $message, $data = [], $error_code = '') {
        // Only log if WordPress debugging is enabled or it's an error
        if (!defined('WP_DEBUG') || !WP_DEBUG) {
            if ($level !== self::LEVEL_ERROR) {
                return;
            }
        }

        $log_message = sprintf(
            '[MBBank MH] [%s] [%s] %s',
            $level,
            $context,
            $message
        );

        if (!empty($error_code)) {
            $log_message .= sprintf(' [Code: %s]', $error_code);
        }

        if (!empty($data)) {
            $log_message .= ' | Data: ' . wp_json_encode($data, JSON_UNESCAPED_UNICODE);
        }

        error_log($log_message);

        // For critical errors, store in database for admin review
        if ($level === self::LEVEL_ERROR && !empty($error_code)) {
            self::store_critical_error($context, $message, $data, $error_code);
        }
    }

    /**
     * Store critical errors in database for admin review
     *
     * @param string $context
     * @param string $message
     * @param array $data
     * @param string $error_code
     * @return void
     */
    private static function store_critical_error($context, $message, $data, $error_code) {
        // Use transients to avoid database writes on every error
        // Store last 10 errors only
        $errors = get_transient('mbbank_mh_critical_errors') ?: [];
        
        $errors[] = [
            'time' => current_time('mysql'),
            'context' => $context,
            'message' => $message,
            'data' => $data,
            'error_code' => $error_code
        ];

        // Keep only last 10 errors
        $errors = array_slice($errors, -10);

        set_transient('mbbank_mh_critical_errors', $errors, DAY_IN_SECONDS);
    }

    /**
     * Get critical errors for admin review
     *
     * @return array
     */
    public static function get_critical_errors() {
        return get_transient('mbbank_mh_critical_errors') ?: [];
    }

    /**
     * Clear critical errors
     *
     * @return void
     */
    public static function clear_critical_errors() {
        delete_transient('mbbank_mh_critical_errors');
    }

    /**
     * Send email notification for critical errors (throttled)
     *
     * @param string $context
     * @param string $message
     * @param array $data
     * @return void
     */
    public static function notify_admin($context, $message, $data = []) {
        // Throttle: max 1 email per hour
        $throttle_key = 'mbbank_mh_email_throttle_' . md5($context . $message);
        
        if (get_transient($throttle_key)) {
            return; // Already sent recently
        }

        set_transient($throttle_key, true, HOUR_IN_SECONDS);

        $admin_email = get_option('admin_email');
        $subject = '[MBBank MH] Critical Error Alert';
        
        $body = sprintf(
            "A critical error occurred in MBBank MH plugin:\n\n" .
            "Context: %s\n" .
            "Message: %s\n" .
            "Time: %s\n\n" .
            "Data: %s\n\n" .
            "Please check the error logs for more details.",
            $context,
            $message,
            current_time('mysql'),
            print_r($data, true)
        );

        wp_mail($admin_email, $subject, $body);
    }
}

