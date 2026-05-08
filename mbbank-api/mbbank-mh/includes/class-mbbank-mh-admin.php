<?php

/**
 * The admin-specific functionality of the plugin.
 *
 * @link       https://dominhhai.com/
 * @since      1.0.0
 *
 * @package    Mbbank_Mh
 * @subpackage Mbbank_Mh/admin
 */

/**
 * The admin-specific functionality of the plugin.
 *
 * @package    Mbbank_Mh
 * @subpackage Mbbank_Mh/admin
 * @author     MH Developer <dev@example.com>
 */
class Mbbank_Mh_Admin {

    // Constants for configuration
    const SYNC_INTERVAL = 20; // seconds
    const LOCK_TIMEOUT = 30; // seconds
    const MAX_API_RETRIES = 3;
    const RATE_LIMIT_SYNC = 10; // seconds between syncs
    const RATE_LIMIT_WAITING_MAX = 30; // max requests per minute
    const RATE_LIMIT_WAITING_WINDOW = 60; // time window in seconds
    const CACHE_DURATION = 30; // seconds for query result caching
    
    // Frontend polling configuration (in seconds)
    const POLLING_INITIAL_DELAY = 0;       // No initial delay (first check immediately)
    const POLLING_INTERVAL_PHASE1 = 30;   // 0-5 minutes: every 30s
    const POLLING_INTERVAL_PHASE2 = 60;   // 5-10 minutes: every 60s
    const POLLING_INTERVAL_PHASE3 = 120;  // 10+ minutes: every 120s (only if max_time extends)
    const POLLING_PHASE1_END = 300;       // Phase 1 ends at 5 minutes
    const POLLING_PHASE2_END = 600;       // Phase 2 ends at 10 minutes
    const POLLING_MAX_TIME = 600;        // Stop polling after 10 minutes
    /** Min seconds between API pulls triggered by customer poll (wp-cron may not run immediately). */
    const POLL_API_GLOBAL_COOLDOWN_SECONDS = 15;

    private $plugin_name;
    private $version;
    private $settings;
    private $cron_table;
    private $transaction_table;
    private $locks_table;
    private $tables_verified = false;

    /**
     * Initialize the class and set its properties.
     *
     * @since    1.0.0
     * @param      string    $plugin_name       The name of this plugin.
     * @param      string    $version    The version of this plugin.
     */
    public function __construct( $plugin_name, $version ) {
        global $wpdb;
        
        $this->plugin_name = $plugin_name;
        $this->version = $version;
        
        // Cache settings in memory to avoid repeated DB queries
        $settings_json = get_option('mbb_gw_settings', '');
        $this->settings = $settings_json ? json_decode($settings_json, true) : [];
        if (!is_array($this->settings)) {
            $this->settings = [];
        }
        
        // Initialize table names - check both with and without prefix
        $table_with_prefix = $wpdb->prefix . 'mbb_gateway_transactions';
        $table_without_prefix = 'mbb_gateway_transactions';
        
        // Check which table exists
        $table_exists_with_prefix = $wpdb->get_var("SHOW TABLES LIKE '$table_with_prefix'");
        $table_exists_without_prefix = $wpdb->get_var("SHOW TABLES LIKE '$table_without_prefix'");
        
        if ($table_exists_with_prefix) {
            $this->transaction_table = $table_with_prefix;
            $this->cron_table = $wpdb->prefix . 'mbb_gateway_cron';
            $this->locks_table = $wpdb->prefix . 'mbb_gateway_locks';
            $this->tables_verified = true;
        } else if ($table_exists_without_prefix) {
            $this->transaction_table = $table_without_prefix;
            $this->cron_table = 'mbb_gateway_cron';
            $this->locks_table = 'mbb_gateway_locks';
            $this->tables_verified = true;
        } else {
            // No tables exist - create them and use prefixed names
            $this->transaction_table = $table_with_prefix;
            $this->cron_table = $wpdb->prefix . 'mbb_gateway_cron';
            $this->locks_table = $wpdb->prefix . 'mbb_gateway_locks';
            $this->create_tables_if_not_exist();
            $this->tables_verified = true;
        }

        add_filter( 'woocommerce_payment_gateways', [$this, 'add_gateway_class'] );

        // Nạp gateway ngay lập tức để WooCommerce thấy được
        $this->init_gateway_class();

        add_action( 'plugins_loaded', [$this, 'init_gateway_class'] );

        add_action('admin_menu', [$this, 'add_admin_pages']);

        add_action('wp_ajax_mbb_gw_reset_all_data', [$this, 'mbb_gw_reset_all_data']);

        add_action('wp_ajax_mbb_gw_get_transactions', [$this, 'mbb_gw_get_transactions']);
        add_action('wp_ajax_mbb_gw_login', [$this, 'mbb_gw_login']);

        add_action('wp_ajax_mbb_gw_sync_transactions', [$this, 'mbb_gw_sync_transactions']);

        add_action('wp_ajax_mbb_gw_waiting_payment', [$this, 'mbb_gw_waiting_payment']);
        add_action('wp_ajax_nopriv_mbb_gw_waiting_payment', [$this, 'mbb_gw_waiting_payment']);

        add_action('wp_ajax_mbb_gw_get_option', [$this, 'get_option']);
        add_action('wp_ajax_mbb_gw_save_option', [$this, 'save_option']);
        add_action('wp_ajax_mbb_gw_test_api', [$this, 'mbb_gw_test_api']);
        add_action('wp_ajax_mbb_gw_test_hooks', [$this, 'mbb_gw_test_hooks']);
        
        // Add scheduled sync hooks
        add_action('mbbank_sync_hook', [$this, 'background_sync_transactions']);
        add_action('mbbank_smart_sync', [$this, 'smart_sync_pending_orders']);
        add_action('mbbank_cleanup_orders', [$this, 'cleanup_pending_orders']);
        
        // Add custom cron intervals (filter registration is safe to do early)
        add_filter('cron_schedules', [$this, 'add_custom_cron_intervals']);
        
        // Schedule cron jobs on init hook instead of constructor to avoid early translation loading
        add_action('init', [$this, 'maybe_schedule_cron_jobs']);
        
        // Add hooks to sync payment status when order status changes
        add_action('woocommerce_order_status_changed', [$this, 'sync_payment_status_on_order_change'], 10, 4);
        add_action('woocommerce_order_status_completed', [$this, 'mark_payment_as_completed'], 10, 2);
        add_action('woocommerce_order_status_processing', [$this, 'mark_payment_as_processing'], 10, 2);
        add_action('woocommerce_order_status_cancelled', [$this, 'mark_payment_as_cancelled'], 10, 2);
        add_action('woocommerce_order_status_refunded', [$this, 'mark_payment_as_cancelled'], 10, 2);
        add_action('woocommerce_order_status_failed', [$this, 'mark_payment_as_cancelled'], 10, 2);
    }

    private function verify_admin_ajax_nonce() {
        $nonce = isset($_POST['nonce']) ? sanitize_text_field(wp_unslash($_POST['nonce'])) : '';
        if (!wp_verify_nonce($nonce, 'mbb_gw_admin_nonce')) {
            echo json_encode(['success' => false, 'msg' => 'Invalid security token']);
            die();
        }
    }

    /**
     * Parse nested settings from AJAX (JSON body preferred; some hosts mishandle nested POST arrays).
     *
     * @return array<string, mixed>|null
     */
    private function parse_ajax_settings_payload() {
        if (isset($_POST['data_json'])) {
            $raw = wp_unslash($_POST['data_json']);
            if (is_string($raw) && $raw !== '') {
                $decoded = json_decode($raw, true);
                if (is_array($decoded)) {
                    return $decoded;
                }
            }
        }
        if (!isset($_POST['data'])) {
            return null;
        }
        $data = wp_unslash($_POST['data']);
        if (is_array($data)) {
            return $data;
        }
        if (is_string($data) && $data !== '') {
            $decoded = json_decode($data, true);
            if (is_array($decoded)) {
                return $decoded;
            }
        }
        return null;
    }

    private function acquire_sync_transient_lock($lock_key, $ttl = 30) {
        if (get_transient($lock_key)) {
            return false;
        }

        set_transient($lock_key, true, max(5, intval($ttl)));
        return true;
    }

    private function release_sync_transient_lock($lock_key) {
        delete_transient($lock_key);
    }

    private function maybe_schedule_order_sync($order_id, $cooldown_seconds = 20) {
        $normalized_order_id = intval($order_id);
        if ($normalized_order_id <= 0) {
            return;
        }

        $schedule_lock_key = 'mbbank_sync_scheduled_' . $normalized_order_id;
        if (get_transient($schedule_lock_key)) {
            return;
        }

        set_transient($schedule_lock_key, true, max(5, intval($cooldown_seconds)));
        wp_schedule_single_event(time(), 'mbbank_sync_hook', [$normalized_order_id]);

        // Customer polling only hits mbb_gw_waiting_payment; it does not call FastAPI by itself.
        // Scheduled mbbank_sync_hook often runs later (or never if wp-cron is starved). Pull once now,
        // throttled site-wide, so the transaction API actually receives requests during checkout wait.
        $global_pull_key = 'mbbank_waiting_payment_api_pull';
        if (!get_transient($global_pull_key)) {
            set_transient($global_pull_key, 1, self::POLL_API_GLOBAL_COOLDOWN_SECONDS);
            $this->mbb_gw_sync_transactions_internal();
        }
    }

    /**
     * Sync payment status when order status changes in admin
     */
    public function sync_payment_status_on_order_change($order_id, $old_status, $new_status, $order) {
        // Validate inputs
        if (!$order_id || !$order || !is_a($order, 'WC_Order')) {
            return;
        }
        
        // Only process if this is an MBBank order
        if ($order->get_payment_method() !== 'mbbank-gateway-mh') {
            return;
        }
        
        global $wpdb;
        
        // Ensure table exists
        $table_exists = $wpdb->get_var("SHOW TABLES LIKE '$this->transaction_table'");
        if (!$table_exists) {
            error_log("MBBank MH: Transaction table does not exist for order #{$order_id}");
            return;
        }
        
        // Log the status change for debugging
        if (defined('WP_DEBUG') && WP_DEBUG) {
            error_log("MBBank MH: Order #{$order_id} status changed from {$old_status} to {$new_status}");
        }
        
        // If order is marked as completed, mark payment as paid
        if ($new_status === 'completed') {
            $result = $wpdb->update(
                $this->transaction_table,
                ['is_paid' => 1],
                ['order_id' => $order_id],
                ['%d'],
                ['%d']
            );
            
            if ($result !== false) {
                error_log("MBBank MH: Marked payment as paid for order #{$order_id}");
            }
        }
        // If order is cancelled/refunded/failed, mark payment as unpaid
        elseif (in_array($new_status, ['cancelled', 'refunded', 'failed'])) {
            $result = $wpdb->update(
                $this->transaction_table,
                ['is_paid' => 0],
                ['order_id' => $order_id],
                ['%d'],
                ['%d']
            );
            
            if ($result !== false) {
                error_log("MBBank MH: Marked payment as unpaid for order #{$order_id}");
            }
        }
    }
    
    /**
     * Mark payment as completed when order reaches completed status
     */
    public function mark_payment_as_completed($order_id, $order) {
        $this->update_payment_status($order_id, $order, 1, 'completed');
    }
    
    /**
     * Mark payment as processing when order reaches processing status
     */
    public function mark_payment_as_processing($order_id, $order) {
        $this->update_payment_status($order_id, $order, 0, 'processing');
    }
    
    /**
     * Mark payment as cancelled when order is cancelled/refunded/failed
     */
    public function mark_payment_as_cancelled($order_id, $order) {
        $this->update_payment_status($order_id, $order, 0, 'cancelled');
    }
    
    /**
     * Helper method to update payment status
     */
    private function update_payment_status($order_id, $order, $is_paid, $status_name) {
        // Validate inputs
        if (!$order_id || !$order || !is_a($order, 'WC_Order')) {
            return;
        }
        
        // Only process if this is an MBBank order
        if ($order->get_payment_method() !== 'mbbank-gateway-mh') {
            return;
        }
        
        global $wpdb;
        
        // Ensure table exists
        $table_exists = $wpdb->get_var("SHOW TABLES LIKE '$this->transaction_table'");
        if (!$table_exists) {
            error_log("MBBank MH: Transaction table does not exist for order #{$order_id}");
            return;
        }
        
        // Update payment status
        $result = $wpdb->update(
            $this->transaction_table,
            ['is_paid' => $is_paid],
            ['order_id' => $order_id],
            ['%d'],
            ['%d']
        );
        
        if ($result !== false) {
            $status_text = $is_paid ? 'paid' : 'unpaid';
            error_log("MBBank MH: Marked payment as {$status_text} for order #{$order_id} (status: {$status_name})");
        } else {
            error_log("MBBank MH: Failed to update payment status for order #{$order_id}");
        }
    }

    public function mbb_gw_reset_all_data(){
        if (!current_user_can('manage_options')) {
            echo wp_json_encode(['success' => false, 'msg' => 'Không có quyền truy cập']);
            die();
        }
        $this->verify_admin_ajax_nonce();

        global $wpdb;
        
        // Check if tables exist before trying to delete
        $transaction_table_exists = $wpdb->get_var("SHOW TABLES LIKE '$this->transaction_table'");
        $cron_table_exists = $wpdb->get_var("SHOW TABLES LIKE '$this->cron_table'");
        
        if ($transaction_table_exists) {
            $sql = "DELETE FROM $this->transaction_table";
            $wpdb->query($sql);
        }
        
        if ($cron_table_exists) {
            $sql = "DELETE FROM $this->cron_table";
            $wpdb->query($sql);
        }
        
        echo json_encode(['success' => true, 'msg' => 'Đã xóa toàn bộ dữ liệu']);
        die();
    }

    public function mbb_gw_waiting_payment(){
        header('Content-Type: application/json');

        $order_id = isset($_REQUEST['order_id']) ? intval($_REQUEST['order_id']) : 0;
        $nonce = isset($_REQUEST['nonce']) ? sanitize_text_field(wp_unslash($_REQUEST['nonce'])) : '';
        $order_key = isset($_REQUEST['order_key']) ? sanitize_text_field(wp_unslash($_REQUEST['order_key'])) : '';
        if (!$order_id) {
            echo json_encode(['success' => false, 'msg' => 'Missing order_id']);
            die();
        }

        $request_order = wc_get_order($order_id);
        if (
            !$request_order ||
            !is_a($request_order, 'WC_Order') ||
            $request_order->get_payment_method() !== 'mbbank-gateway-mh'
        ) {
            echo json_encode(['success' => false, 'msg' => 'Invalid order']);
            die();
        }

        $stored_order_key = (string) $request_order->get_order_key();
        $is_valid_nonce = $nonce !== '' && wp_verify_nonce($nonce, 'check-payment_' . $order_id);
        $is_valid_order_key = $order_key !== '' && hash_equals($stored_order_key, $order_key);
        if (!$is_valid_nonce && !$is_valid_order_key) {
            echo json_encode(['success' => false, 'msg' => 'Invalid security token']);
            die();
        }

        // Only after auth: rate limit. (Previously, rate-limit responses could expose order status without a valid nonce/key.)
        if (!$this->check_rate_limit('mbb_gw_waiting_payment', self::RATE_LIMIT_WAITING_MAX, self::RATE_LIMIT_WAITING_WINDOW)) {
            $order_status = $request_order->get_status();
            echo json_encode([
                'success' => false,
                'status' => $order_status,
                'msg' => 'Rate limit reached. Please wait.',
                'rate_limited' => true,
            ]);
            die();
        }
        
        if($order_id)
        {
            global $wpdb;
            
            // Ensure tables exist before using them
            $cron_table_exists = $wpdb->get_var("SHOW TABLES LIKE '$this->cron_table'");
            $transaction_table_exists = $wpdb->get_var("SHOW TABLES LIKE '$this->transaction_table'");
            
            if (!$cron_table_exists || !$transaction_table_exists) {
                $this->create_tables_if_not_exist();
            }

            if (isset($_REQUEST['cron']))
            {
                    $this->mbb_gw_sync_transactions();
                    die();
            }

            // Debounce per-order scheduling to avoid wp-cron burst under aggressive polling.
            $this->maybe_schedule_order_sync($order_id, 20);

            $sql = $wpdb->prepare("SELECT * FROM $this->transaction_table WHERE order_id = %d AND is_paid = 1", $order_id);
            $recordExist = $wpdb->get_row($sql, ARRAY_A);
            if($recordExist)
            {
                echo json_encode(['success' => true, 'msg' => 'Thanh toán thành công', 'data' => $recordExist]);
                die();
            }

            $order = $request_order;
            if (
                $order &&
                is_a($order, 'WC_Order') &&
                $order->get_payment_method() === 'mbbank-gateway-mh' &&
                $order->has_status(['completed', 'processing'])
            ) {
                $this->update_payment_status($order_id, $order, 1, 'woocommerce_status_sync');
                echo json_encode([
                    'success' => true,
                    'msg' => 'Đơn hàng đã được xác nhận thanh toán',
                    'data' => [
                        'order_id' => $order_id,
                        'status' => $order->get_status(),
                        'source' => 'woocommerce',
                    ],
                ]);
                die();
            }
        }

        $order_status = null;
        if (!isset($order)) {
            $order = $request_order;
        }
        if ($order && is_a($order, 'WC_Order')) {
            $order_status = $order->get_status();
        }

        echo json_encode(['success' => false, 'status' => $order_status]);
        die();
    }

    public function mbb_gw_sync_transactions(){
        if (defined('DOING_AJAX') && DOING_AJAX) {
            $this->verify_admin_ajax_nonce();
        }
        $is_manual_sync = isset($_POST['action']) && $_POST['action'] === 'mbb_gw_sync_transactions';
        
        if (defined('DOING_AJAX') && DOING_AJAX && $is_manual_sync) {
            header('Content-Type: application/json');
        }
        
        // Use shared lock with smart sync to avoid concurrent heavy runs.
        $sync_lock_key = 'mbbank_sync_global_in_progress';
        if (!$this->acquire_sync_transient_lock($sync_lock_key, self::RATE_LIMIT_SYNC) && !$is_manual_sync) {
            Mbbank_Mh_Logger::debug('sync', 'Sync already in progress, skipping');
            return;
        }
        
        global $wpdb;
        
        // Ensure tables exist before sync
        $cron_table_exists = $wpdb->get_var("SHOW TABLES LIKE '$this->cron_table'");
        $transaction_table_exists = $wpdb->get_var("SHOW TABLES LIKE '$this->transaction_table'");
        
        if (!$cron_table_exists || !$transaction_table_exists) {
            $this->create_tables_if_not_exist();
        }

        try {
        $date = date("Y-m-d H:i:s");
            $sql = $wpdb->prepare("INSERT INTO `$this->cron_table` (`time`, `json`) VALUES (%s, '')", $date);
        $wpdb->query($sql);

        $auth = get_option('mbb_gw_login');

            if($auth) {
            $auth = $this->decode_($auth);
            $response = $this->call_mbbank_api($auth);
            $response = json_decode($response, true);

            if(isset($response['success']) && $response['success'] == 1 && isset($response['results']) && is_array($response['results']) && count($response['results']) > 0){
                $transactions = $response['results'];
                    $count = 0;
                    $completed_orders = 0;
                    $completed_order_ids = [];
                    $errors = [];

                foreach ($transactions as $key => $t) {
                    try {
                        // Validate transaction data structure
                        if (!is_array($t) || empty($t['transactionNumber'])) {
                            $errors[] = "Invalid transaction data at index {$key}";
                            continue;
                        }
                        
                        // Sanitize and validate transaction number
                        $tranId = sanitize_text_field($t['transactionNumber']);
                        if (empty($tranId) || strlen($tranId) > 50) {
                            $errors[] = "Invalid transaction ID at index {$key}";
                            continue;
                        }
                        
                        // Check if transaction already exists
                        $sql = $wpdb->prepare("SELECT * FROM $this->transaction_table WHERE tranId = %s", $tranId);
                        $recordExist = $wpdb->get_row($sql);

                        if(!$recordExist) {
                            $tranData = $this->buildTransactionData($t);
                            if($tranData && is_array($tranData)) {
                                $result = $wpdb->insert($this->transaction_table, $tranData);
                                if ($result !== false) {
                                    $count++;
                                    
                                    if (isset($tranData['is_paid']) && $tranData['is_paid'] == 1 && isset($tranData['order_id']) && $tranData['order_id'] > 0) {
                                        $completed_orders++;
                                        $completed_order_ids[] = intval($tranData['order_id']);
                                    }
                                } else {
                                    $errors[] = "Failed to insert transaction {$tranId}: " . $wpdb->last_error;
                                }
                            } else {
                                $errors[] = "Failed to build transaction data for {$tranId}";
                            }
                        }
                    } catch (Exception $e) {
                        $errors[] = "Error processing transaction at index {$key}: " . $e->getMessage();
                        error_log("MBBank MH: Transaction processing error: " . $e->getMessage());
                    }
                }
                
                // Log errors if any
                if (!empty($errors) && defined('WP_DEBUG') && WP_DEBUG) {
                    error_log("MBBank MH: Sync errors: " . implode(', ', $errors));
                }
                    
                    // Return success response for manual AJAX sync only
                    if (defined('DOING_AJAX') && DOING_AJAX && $is_manual_sync) {
                        // Check if user is admin to prevent data leakage
                        if (!current_user_can('manage_options')) {
                            echo json_encode([
                                'success' => false, 
                                'msg' => 'Không có quyền thực hiện thao tác này'
                            ]);
                            die();
                        }
                        
                        if ($completed_orders > 0) {
                            echo json_encode([
                                'success' => true, 
                                'msg' => "🎉 Đồng bộ thành công! Đã hoàn thành {$completed_orders} đơn hàng"
                            ]);
                        } elseif ($count > 0) {
                            echo json_encode([
                                'success' => true, 
                                'msg' => "✅ Đồng bộ thành công! Đã thêm {$count} giao dịch mới"
                            ]);
                        } else {
                            echo json_encode([
                                'success' => true, 
                                'msg' => "ℹ️ Đồng bộ thành công! Không có giao dịch mới"
                            ]);
                        }
                        die();
                    }
                } else {
                    if (defined('DOING_AJAX') && DOING_AJAX && $is_manual_sync) {
                        echo json_encode([
                            'success' => false, 
                            'msg' => 'Không có giao dịch mới hoặc API trả về lỗi: ' . ($response['msg'] ?? 'Unknown error')
                        ]);
                        die();
                    }
                }
            } else {
                if (defined('DOING_AJAX') && DOING_AJAX && $is_manual_sync) {
                    echo json_encode([
                        'success' => false, 
                        'msg' => 'Chưa cấu hình thông tin đăng nhập API'
                    ]);
                    die();
                }
            }
        } catch (Exception $e) {
            if (defined('DOING_AJAX') && DOING_AJAX && $is_manual_sync) {
                echo json_encode([
                    'success' => false, 
                    'msg' => 'Có lỗi xảy ra: ' . $e->getMessage()
                ]);
                die();
            }
        } finally {
            $this->release_sync_transient_lock($sync_lock_key);
        }
    }

    public function background_sync_transactions($order_id = null) {
        $this->mbb_gw_sync_transactions_internal();
    }

    private function mbb_gw_sync_transactions_internal() {
        global $wpdb;

        try {
            set_transient('mbbank_last_sync_attempt_at', current_time('mysql'), 300);
            $date = date("Y-m-d H:i:s");
            $sql = $wpdb->prepare("INSERT INTO `$this->cron_table` (`time`, `json`) VALUES (%s, '')", $date);
            $wpdb->query($sql);

            $auth = get_option('mbb_gw_login');
            if($auth) {
                $auth = $this->decode_($auth);
                $response = $this->call_mbbank_api($auth);
                $response = json_decode($response, true);

                if(isset($response['success']) && $response['success'] == 1 && sizeof($response['results'])) {
                    $transactions = $response['results'];

                    foreach ($transactions as $key => $t) {
                        $sql = $wpdb->prepare("SELECT * FROM $this->transaction_table WHERE tranId = %s", $t['transactionNumber']);
                        $recordExist = $wpdb->get_row($sql);

                        if(!$recordExist) {
                            $tranData = $this->buildTransactionData($t);
                            if($tranData) {
                                $wpdb->insert($this->transaction_table, $tranData);
                            }
                        }
                    }
                    delete_transient('mbbank_last_sync_error');
                } else {
                    $api_msg = is_array($response) ? ($response['msg'] ?? 'Unknown API error') : 'Unknown API error';
                    set_transient('mbbank_last_sync_error', 'API sync failed: ' . sanitize_text_field((string) $api_msg), 300);
                }
            } else {
                set_transient('mbbank_last_sync_error', 'API token (mbb_gw_login) is not configured.', 300);
            }
        } catch (Exception $e) {
            $error_message = 'Background sync exception: ' . $e->getMessage();
            Mbbank_Mh_Logger::error('sync_internal', $error_message, ['exception' => $e->getMessage()], Mbbank_Mh_Logger::ERROR_API_CALL);
            set_transient('mbbank_last_sync_error', $error_message, 300);
        }
    }
    
    /**
     * Add custom cron intervals
     */
    public function add_custom_cron_intervals($schedules) {
        $schedules['every_30_seconds'] = [
            'interval' => 30,
            'display'  => __('Every 30 Seconds')
        ];
        $schedules['every_15_minutes'] = [
            'interval' => 900,
            'display'  => __('Every 15 Minutes')
        ];
        return $schedules;
    }
    
    /**
     * Maybe schedule cron jobs if not already scheduled
     * Called on 'init' hook to avoid early translation loading issues
     */
    public function maybe_schedule_cron_jobs() {
        if (!wp_next_scheduled('mbbank_smart_sync')) {
            wp_schedule_event(time(), 'every_30_seconds', 'mbbank_smart_sync');
        }
        if (!wp_next_scheduled('mbbank_cleanup_orders')) {
            wp_schedule_event(time(), 'every_15_minutes', 'mbbank_cleanup_orders');
        }
    }
    
    /**
     * Schedule all cron jobs (called during plugin activation)
     */
    public function schedule_cron_jobs() {
        // Clear existing schedules first to avoid duplicates
        wp_clear_scheduled_hook('mbbank_smart_sync');
        wp_clear_scheduled_hook('mbbank_cleanup_orders');
        
        // Schedule new cron jobs
        wp_schedule_event(time(), 'every_30_seconds', 'mbbank_smart_sync');
        wp_schedule_event(time(), 'every_15_minutes', 'mbbank_cleanup_orders');
    }
    
    /**
     * Unschedule all cron jobs (called during plugin deactivation)
     */
    public function unschedule_cron_jobs() {
        wp_clear_scheduled_hook('mbbank_smart_sync');
        wp_clear_scheduled_hook('mbbank_cleanup_orders');
        wp_clear_scheduled_hook('mbbank_sync_hook');
    }
    
    /**
     * Smart Sync: Only check pending orders created in last 60 minutes
     * This is the production-optimized sync that runs every 30 seconds
     */
    public function smart_sync_pending_orders() {
        global $wpdb;
        
        // Share same lock with manual/background sync for consistency.
        $sync_lock_key = 'mbbank_sync_global_in_progress';
        if (!$this->acquire_sync_transient_lock($sync_lock_key, 30)) {
            Mbbank_Mh_Logger::debug('smart_sync', 'Smart sync already in progress, skipping');
            return;
        }
        
        $start_time = microtime(true);
        
        try {
            // Step 1: Get pending orders from last 60 minutes
            $args = [
                'status' => 'pending',
                'payment_method' => 'mbbank-gateway-mh',
                'date_created' => '>' . (time() - 900), // Last 15 minutes
                'limit' => 50,
                'orderby' => 'date',
                'order' => 'DESC'
            ];
            
            $pending_orders = wc_get_orders($args);
            
            if (empty($pending_orders)) {
                Mbbank_Mh_Logger::debug('smart_sync', 'No pending orders to check');
                return;
            }
            
            // Step 2: Build pending-order lookup for O(1) checks.
            $order_map = [];
            $prefix = $this->settings['prefix'] ?? 'DH';
            $suffix = $this->settings['subfix'] ?? '';
            
            foreach ($pending_orders as $order) {
                $order_id = $order->get_id();
                $order_map[intval($order_id)] = true;
            }
            
            Mbbank_Mh_Logger::debug('smart_sync', 'Checking ' . count($pending_orders) . ' pending orders');
            
            // Step 3: Call API with smart filters
            $auth = get_option('mbb_gw_login');
            if (!$auth) {
                Mbbank_Mh_Logger::error('smart_sync', 'No auth credentials found');
                return;
            }
            
            $auth = $this->decode_($auth);
            
            // Call API with filters
            $response = $this->call_mbbank_api($auth, false, [
                'from_date' => date('Y-m-d'),
                'to_date' => date('Y-m-d'),
                'description_contains' => $prefix,
                'limit' => 100
            ]);
            
            $response_data = json_decode($response, true);
            
            if (!isset($response_data['success']) || $response_data['success'] != 1) {
                Mbbank_Mh_Logger::error('smart_sync', 'API call failed', ['response' => $response_data]);
                return;
            }
            
            $transactions = $response_data['results'] ?? [];
            $matched_count = 0;
            
            // Step 4: Match transactions with pending orders
            foreach ($transactions as $transaction) {
                $description = $transaction['description'] ?? '';
                
                $order_id = null;
                $extracted_ids = $this->getInbetweenStrings($prefix, $suffix, $description);
                if (!empty($extracted_ids) && is_array($extracted_ids)) {
                    $order_id = intval($extracted_ids[0]);
                }

                if (!$order_id || !isset($order_map[$order_id])) {
                    continue;
                }

                // Check if not already processed
                $tranId = sanitize_text_field($transaction['transactionNumber'] ?? '');
                $existing = $wpdb->get_var($wpdb->prepare(
                    "SELECT COUNT(*) FROM {$this->transaction_table} WHERE tranId = %s",
                    $tranId
                ));
                
                if (!$existing) {
                    // Process this transaction
                    $tranData = $this->buildTransactionData($transaction);
                    if ($tranData && is_array($tranData)) {
                        $result = $wpdb->insert($this->transaction_table, $tranData);
                        
                        if ($result !== false) {
                            $matched_count++;
                            
                            // Trigger action hook for real-time notifications
                            if (isset($tranData['is_paid']) && $tranData['is_paid'] == 1 && isset($tranData['order_id'])) {
                                do_action('mbbank_payment_received', $tranData['order_id'], $tranData);
                                Mbbank_Mh_Logger::debug('smart_sync', "Order #{$tranData['order_id']} paid - triggered notification");
                            }
                        }
                    }
                }
            }
            
            $elapsed_time = round((microtime(true) - $start_time) * 1000, 2);
            
            Mbbank_Mh_Logger::debug('smart_sync', "Smart sync completed: {$matched_count} matches from " . count($transactions) . " transactions in {$elapsed_time}ms");
            
        } catch (Exception $e) {
            Mbbank_Mh_Logger::error('smart_sync', 'Smart sync failed', ['error' => $e->getMessage()]);
        } finally {
            $this->release_sync_transient_lock($sync_lock_key);
        }
    }
    
    /**
     * Auto-cleanup: Cancel unpaid orders after configured timeout
     * Runs every 15 minutes
     * Timeout can be configured in admin settings (default: 60 minutes)
     */
    public function cleanup_pending_orders() {
        global $wpdb;
        
        try {
            // Get timeout from settings (in seconds)
            $timeout_seconds = !empty($this->settings['auto_cancel']['timeout']) 
                ? intval($this->settings['auto_cancel']['timeout']) 
                : 3600; // Default 60 minutes
            
            // If timeout is 0, auto-cancel is disabled
            if ($timeout_seconds <= 0) {
                Mbbank_Mh_Logger::debug('cleanup', 'Auto-cancel is disabled');
                return;
            }
            
            $timeout_minutes = $timeout_seconds / 60;
            $cutoff_time = time() - $timeout_seconds;
            
            // Find pending orders older than configured timeout
            $args = [
                'status' => 'pending',
                'payment_method' => 'mbbank-gateway-mh',
                'date_created' => '<' . $cutoff_time,
                'limit' => 50,
                'orderby' => 'date',
                'order' => 'ASC'
            ];
            
            $old_pending_orders = wc_get_orders($args);
            
            if (empty($old_pending_orders)) {
                Mbbank_Mh_Logger::debug('cleanup', 'No old pending orders to cleanup');
                return;
            }
            
            $cancelled_count = 0;
            
            foreach ($old_pending_orders as $order) {
                $order_id = $order->get_id();
                
                // Verify no paid transaction exists
                $paid_transaction = $wpdb->get_var($wpdb->prepare(
                    "SELECT COUNT(*) FROM {$this->transaction_table} WHERE order_id = %d AND is_paid = 1",
                    $order_id
                ));
                
                if (!$paid_transaction) {
                    // No payment found - auto-cancel
                    $order->update_status(
                        'cancelled',
                        sprintf(
                            __('Auto-cancelled: Payment timeout (%d minutes)', 'mbbank-mh'),
                            $timeout_minutes
                        )
                    );
                    
                    $cancelled_count++;
                    
                    Mbbank_Mh_Logger::debug('cleanup', "Order #{$order_id} auto-cancelled - payment timeout");
                    
                    // Optional: Send email notification
                    // do_action('mbbank_order_auto_cancelled', $order_id);
                }
            }
            
            if ($cancelled_count > 0) {
                Mbbank_Mh_Logger::debug('cleanup', "Auto-cancelled {$cancelled_count} orders due to payment timeout");
            }
            
        } catch (Exception $e) {
            Mbbank_Mh_Logger::error('cleanup', 'Cleanup failed', ['error' => $e->getMessage()]);
        }
    }

    public function mbb_gw_test_api(){
        // Check admin permission
        if(!current_user_can('manage_options')) {
            echo json_encode(['success' => false, 'msg' => 'Không có quyền truy cập']);
            die();
        }
        $this->verify_admin_ajax_nonce();

        // Only allow test endpoints when debug mode is enabled from admin.
        $settings = json_decode(get_option('mbb_gw_settings', '{}'), true);
        $debug_enabled = !empty($settings['debug']['enabled']);
        if (!$debug_enabled) {
            echo json_encode(['success' => false, 'msg' => 'Debug mode is disabled']);
            die();
        }
        
        header('Content-Type: application/json');
        
        $access_token = isset($_POST['access_token']) ? sanitize_text_field($_POST['access_token']) : '';
        
        if (empty($access_token)) {
            echo json_encode(['success' => false, 'msg' => 'Access token không được để trống']);
            die();
        }
        
        // Validate access token format
        try {
            $access_token = Mbbank_Mh_Validator::validate_access_token($access_token);
        } catch (Exception $e) {
            echo json_encode(['success' => false, 'msg' => $e->getMessage()]);
            die();
        }
        
        try {
            // Get API endpoint from settings
            $settings = json_decode(get_option('mbb_gw_settings', '{}'), true);
            $api_endpoint = $settings['api']['endpoint'] ?? 'http://localhost:8081/transactions';
            
            // Prepare date range (last 30 days)
            $to_date = date('Y-m-d');
            $from_date = date('Y-m-d', strtotime('-30 days'));
            
            $payload = [
                'from_date' => $from_date,
                'to_date' => $to_date
            ];
            
            
            // Make API call
            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $api_endpoint);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 10); // Reduce timeout for better UX
            curl_setopt($ch, CURLOPT_HTTPHEADER, [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $access_token
            ]);
            
            $response = curl_exec($ch);
            $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $curl_error = curl_error($ch);
            curl_close($ch);
            
            
            if ($curl_error) {
                echo json_encode(['success' => false, 'msg' => 'Lỗi cURL: ' . $curl_error]);
                die();
            }
            
            if ($http_code !== 200) {
                echo json_encode(['success' => false, 'msg' => "API trả về lỗi HTTP {$http_code}. Kiểm tra endpoint và token."]);
                die();
            }
            
            if (empty($response)) {
                echo json_encode(['success' => false, 'msg' => 'API trả về response rỗng']);
                die();
            }
            
            $data = json_decode($response, true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                echo json_encode(['success' => false, 'msg' => 'API trả về dữ liệu không hợp lệ (không phải JSON)']);
                die();
            }
            
            // Check response format
            $transaction_count = 0;
            if (isset($data['success']) && $data['success'] == 1 && isset($data['results'])) {
                // Standard format
                $transaction_count = count($data['results']);
            } elseif (is_array($data)) {
                // Direct array format
                $transaction_count = count($data);
            }
            
            echo json_encode([
                'success' => true, 
                'msg' => 'Kết nối API thành công',
                'transaction_count' => $transaction_count,
                'date_range' => "Từ {$from_date} đến {$to_date}",
                'endpoint' => $api_endpoint
            ]);
            
        } catch (Exception $e) {
            echo json_encode(['success' => false, 'msg' => 'Lỗi hệ thống: ' . $e->getMessage()]);
        }
        
        die();
    }

    public function mbb_gw_test_hooks(){
        // Check admin permission
        if(!current_user_can('manage_options')) {
            echo json_encode(['success' => false, 'msg' => 'Không có quyền truy cập']);
            die();
        }
        
        // Only allow test endpoints when debug mode is enabled from admin.
        $settings = json_decode(get_option('mbb_gw_settings', '{}'), true);
        $debug_enabled = !empty($settings['debug']['enabled']);
        if (!$debug_enabled) {
            echo json_encode(['success' => false, 'msg' => 'Debug mode is disabled']);
            die();
        }
        
        header('Content-Type: application/json');
        
        // Test if hooks are properly registered
        global $wp_filter;
        
        $hooks_status = [
            'woocommerce_order_status_changed' => isset($wp_filter['woocommerce_order_status_changed']),
            'woocommerce_order_status_completed' => isset($wp_filter['woocommerce_order_status_completed']),
            'woocommerce_order_status_processing' => isset($wp_filter['woocommerce_order_status_processing']),
            'woocommerce_order_status_cancelled' => isset($wp_filter['woocommerce_order_status_cancelled']),
            'woocommerce_order_status_refunded' => isset($wp_filter['woocommerce_order_status_refunded']),
            'woocommerce_order_status_failed' => isset($wp_filter['woocommerce_order_status_failed']),
        ];
        
        $all_registered = array_reduce($hooks_status, function($carry, $item) {
            return $carry && $item;
        }, true);
        
        echo json_encode([
            'success' => $all_registered,
            'msg' => $all_registered ? 'Tất cả hooks đã được đăng ký thành công' : 'Một số hooks chưa được đăng ký',
            'hooks' => $hooks_status,
            'debug_info' => [
                'plugin_active' => is_plugin_active('mbbank-mh/mbbank-mh.php'),
                'woocommerce_active' => class_exists('WooCommerce'),
                'current_user_can' => current_user_can('manage_options')
            ]
        ]);
        
        die();
    }

    public function buildTransactionData($t, $balance = 0){
        try {
            // Validate input structure
            if (!is_array($t)) {
                error_log("MBBank MH: Invalid transaction data - not an array");
                return null;
            }
            
            if (empty($t['transactionNumber']) || !isset($t['type'])) {
                error_log("MBBank MH: Missing required transaction fields");
                return null;
            }
            
            if ($t['type'] !== 'IN') {
                return null; // Only process incoming transactions
            }

            // Sanitize and validate data
            $tranId = sanitize_text_field($t['transactionNumber']);
            $amount = floatval($t['amount'] ?? 0);
            $description = sanitize_text_field($t['description'] ?? '');
            
            // Validate required fields
            if (empty($tranId) || strlen($tranId) > 50) {
                error_log("MBBank MH: Invalid transaction ID: {$tranId}");
                return null;
            }
            
            if ($amount <= 0 || $amount > 999999999) {
                error_log("MBBank MH: Invalid amount: {$amount}");
                return null;
            }

            $tranData = [
                'tranId'      => $tranId,
                'partnerName' => sanitize_text_field($t['partnerName'] ?? ''),
                'amount'      => $amount,
                'comment'     => $description,
                'description' => $description,
                'partnerId'   => sanitize_text_field($t['partnerId'] ?? ''),
                'status'      => 999,
                'ownerName'   => sanitize_text_field($t['ownerName'] ?? ''),
                'ownerNumber' => sanitize_text_field($t['ownerNumber'] ?? ''),
                'ackTime'     => current_time('mysql'),
                'ipAddress'   => sanitize_text_field($t['ipAddress'] ?? 'N/A'),
            ];

            // Extract order ID more safely
            $order_id = null;
            if (isset($this->settings['prefix']) && isset($this->settings['subfix'])) {
                $extracted_ids = $this->getInbetweenStrings(
                    $this->settings['prefix'],
                    $this->settings['subfix'],
                    $description
                );
                $order_id = !empty($extracted_ids) && is_array($extracted_ids) ? intval($extracted_ids[0]) : null;
            }

            if (!$order_id || $order_id <= 0) {
                return $tranData;
            }

            $tranData['order_id'] = $order_id;
            
            // Validate order exists and is correct payment method
            $order = wc_get_order($order_id);
            if (!$order || !is_a($order, 'WC_Order') || $order->get_payment_method() !== 'mbbank-gateway-mh') {
                error_log("MBBank MH: Invalid order #{$order_id} for transaction {$tranId}");
                return $tranData;
            }

            // So sánh tiền - must be exact or more than order total
            $total = floatval($order->get_total());
            if (!empty($this->settings['currency_rate']) && is_numeric($this->settings['currency_rate'])) {
                $total = floatval($this->settings['currency_rate']) * $total;
            }
            
            // Allow small tolerance (1 VND) for rounding issues but ensure minimum payment
            $tolerance = 1.0;
            $received_amount = $amount; // Already validated above
            
            if ($total > 0 && $received_amount >= ($total - $tolerance)) {
                // Use database-based atomic lock mechanism
                if (!$this->acquire_lock($order_id)) {
                    Mbbank_Mh_Logger::warning('payment_processing', 'Order payment already being processed', ['order_id' => $order_id]);
                    return $tranData; // Skip if already being processed
                }
                
                try {
                    // Double-check order status after getting lock
                    $fresh_order = wc_get_order($order_id);
                    if (!$fresh_order || $fresh_order->get_status() === 'completed' || $fresh_order->get_status() === 'processing') {
                        Mbbank_Mh_Logger::info('payment_processing', 'Order already completed, skipping', ['order_id' => $order_id]);
                        return $tranData;
                    }
                    
                    // Check for existing payment transaction
                    global $wpdb;
                    
                    // Use cached query with compound index
                    $existing_payment = $wpdb->get_var($wpdb->prepare(
                        "SELECT COUNT(*) FROM $this->transaction_table WHERE order_id = %d AND is_paid = 1", 
                        $order_id
                    ));
                    
                    if ($existing_payment > 0) {
                        Mbbank_Mh_Logger::info('payment_processing', 'Payment already exists', ['order_id' => $order_id]);
                        return $tranData;
                    }
                    
                    $tranData['is_paid'] = 1;
                    
                    // Get current order status
                    $current_status = $fresh_order->get_status();
                    
                    // Get safe order status - only mark as completed for actual payment completion
                    $target_status = !empty($this->settings['order_status']) ? $this->settings['order_status'] : 'completed';
                    $target_status = sanitize_text_field($target_status);
                    
                    // Check for auto-reactivate scenario
                    $is_reactivation = false;
                    
                    // Get auto-reactivate settings
                    $auto_reactivate_enabled = !empty($this->settings['auto_reactivate']['enabled']);
                    $grace_period = !empty($this->settings['auto_reactivate']['grace_period']) 
                        ? intval($this->settings['auto_reactivate']['grace_period']) 
                        : 86400; // Default 24 hours
                    
                    if ($current_status === 'cancelled' && $auto_reactivate_enabled) {
                        // Check when order was cancelled (use last modified date)
                        $cancelled_time = strtotime($fresh_order->get_date_modified());
                        $time_since_cancel = time() - $cancelled_time;
                        
                        if ($time_since_cancel <= $grace_period) {
                            // Within grace period - auto-reactivate!
                            $is_reactivation = true;
                            $target_status = 'processing'; // Always use 'processing' for reactivated orders
                            
                            Mbbank_Mh_Logger::debug('auto_reactivate', 
                                "Order #{$order_id} will be auto-reactivated - late payment {$received_amount} VND within grace period",
                                [
                                    'order_id' => $order_id,
                                    'amount' => $received_amount,
                                    'transaction_id' => $tranId,
                                    'time_since_cancel' => round($time_since_cancel / 60) . ' minutes'
                                ]
                            );
                        } else {
                            // Exceeded grace period - requires admin review
                            Mbbank_Mh_Logger::warning('late_payment_review_required',
                                "Payment {$received_amount} VND for cancelled order #{$order_id} - exceeds grace period (24 hours)",
                                [
                                    'order_id' => $order_id,
                                    'amount' => $received_amount,
                                    'transaction_id' => $tranId,
                                    'time_since_cancel' => round($time_since_cancel / 3600, 1) . ' hours'
                                ]
                            );
                            
                            // Still save transaction but don't auto-reactivate
                            // Admin can manually review and reactivate
                            do_action('mbbank_late_payment_requires_review', $order_id, $tranData);
                            return $tranData; // Exit early - don't update status
                        }
                    }
                    
                    // Update order status safely using database transaction
                    $wpdb->query('START TRANSACTION');
                    
                    try {
                        $fresh_order->update_status($target_status);
                        
                        // Add appropriate order note based on scenario
                        if ($is_reactivation) {
                            $fresh_order->add_order_note(
                                sprintf(
                                    '🔄 Đơn hàng tự động kích hoạt lại - Phát hiện thanh toán muộn: %s VND - Mã GD: %s - Nội dung: %s', 
                                    number_format($received_amount), 
                                    $tranId,
                                    $description
                                )
                            );
                            
                            Mbbank_Mh_Logger::info('auto_reactivate', 'Order auto-reactivated successfully', [
                                'order_id' => $order_id,
                                'amount' => $received_amount,
                                'transaction_id' => $tranId,
                                'previous_status' => 'cancelled',
                                'new_status' => $target_status
                            ]);
                            
                            // Trigger reactivation hook for custom notifications
                            do_action('mbbank_order_reactivated', $order_id, $tranData);
                            
                            // Send customer email notification (standard WooCommerce processing order email)
                            $mailer = WC()->mailer();
                            $emails = $mailer->get_emails();
                            if (isset($emails['WC_Email_Customer_Processing_Order'])) {
                                $emails['WC_Email_Customer_Processing_Order']->trigger($order_id);
                            }
                            
                        } else {
                            // Normal payment flow
                            $fresh_order->add_order_note(
                                sprintf(
                                    'Thanh toán thành công qua MBBank: %s VND - Mã giao dịch: %s - Nội dung: %s', 
                                    number_format($received_amount), 
                                    $tranId,
                                    $description
                                )
                            );
                            
                            Mbbank_Mh_Logger::info('payment_processing', 'Order payment completed successfully', [
                                'order_id' => $order_id,
                                'amount' => $received_amount,
                                'transaction_id' => $tranId
                            ]);
                        }
                        
                        $wpdb->query('COMMIT');
                        
                    } catch (Exception $e) {
                        $wpdb->query('ROLLBACK');
                        Mbbank_Mh_Logger::error('payment_processing', 'Failed to update order', [
                            'order_id' => $order_id,
                            'error' => $e->getMessage(),
                            'is_reactivation' => $is_reactivation
                        ], Mbbank_Mh_Logger::ERROR_PAYMENT_PROCESSING);
                        throw $e;
                    }
                    
                } finally {
                    // Always release lock
                    $this->release_lock($order_id);
                }
            }

            return $tranData;
            
        } catch (Exception $e) {
            error_log("MBBank MH: Error in buildTransactionData: " . $e->getMessage());
            return null;
        }
    }

    public function mbb_gw_login(){
        if(!current_user_can('manage_options')) {
            echo json_encode(['success' => false, 'msg' => 'Không có quyền truy cập']);
            die();
        }
        $this->verify_admin_ajax_nonce();

        $auth = isset($_POST['auth']) ? $_POST['auth'] : '';

        if(empty($auth['username']) || empty($auth['password'])){
            echo json_encode(['success' => false, 'msg' => 'Thiếu username hoặc password']);
            die();
        }

        try {
            $response = $this->call_mbbank_api($auth, true);
            $response_de = json_decode($response, true);
            
            if(json_last_error() !== JSON_ERROR_NONE) {
                echo json_encode(['success' => false, 'msg' => 'Lỗi phân tích phản hồi từ API']);
                die();
            }

            if(isset($response_de['success']) && $response_de['success']){
                $data = $this->encode_($auth);
                $mbb_gw_login = get_option( 'mbb_gw_login', false );
                
                if(!$mbb_gw_login) {
                    add_option( 'mbb_gw_login', $data, '', false );
                } else {
                    update_option( 'mbb_gw_login', $data, '', false );
                }
            }
            
            echo $response;

        } catch (Exception $e) {
            echo json_encode(['success' => false, 'msg' => 'Lỗi hệ thống: ' . $e->getMessage()]);
        }

        die();
    }

    public function mbb_gw_get_transactions(){
        // Check admin permission
        if(!current_user_can('manage_options')) {
            echo json_encode(['success' => false, 'msg' => 'Không có quyền truy cập']);
            die();
        }
        $this->verify_admin_ajax_nonce();
        
        header('Content-Type: application/json');
        
        global $wpdb;

        // Ensure table exists
        $table_exists = $wpdb->get_var("SHOW TABLES LIKE '$this->transaction_table'");
        if (!$table_exists) {
            $this->create_tables_if_not_exist();
            // Re-check after creation
            $table_exists = $wpdb->get_var("SHOW TABLES LIKE '$this->transaction_table'");
            if (!$table_exists) {
                echo json_encode([
                    'success' => false, 
                    'msg' => 'Không thể tạo bảng giao dịch. Vui lòng kiểm tra quyền database.',
                    'data' => [],
                    'pagination' => ['total' => 0, 'page' => 1, 'per_page' => 20, 'max_page' => 0]
                ]);
                die();
            }
        }

        $page = isset($_POST['page']) ? intval($_POST['page']) : 1;
        $per_page = isset($_POST['per_page']) ? intval($_POST['per_page']) : 20;
        $filters = isset($_POST['filters']) ? $_POST['filters'] : '';

        $whereArr = ["1=1"];
        $where = '';
        $offset = ($page - 1) * $per_page;
        if(sizeof($whereArr) > 0)
            $where = "WHERE (" . implode(" AND ", $whereArr) . ")";

        $sql = "SELECT *  FROM  $this->transaction_table $where  ORDER BY id DESC LIMIT $per_page OFFSET $offset";
        $records = $wpdb->get_results( $sql );
        
        $count_sql = "SELECT COUNT(*) FROM $this->transaction_table $where";
        $total_records = $wpdb->get_var($count_sql);

        $pagination = [
                    'total' => intval($total_records) ?: 0,
                    'page'  => intval($page),
                    'per_page' => intval($per_page),
                    'max_page'  => $total_records ? ceil($total_records / $per_page) : 0
        ];

        $response = [
            'data' => $records ?: [],
            'pagination' => $pagination,
            'success' => true,
            'table_name' => $this->transaction_table
        ];

        echo json_encode($response);
        die();
    }

    public function get_option($key = '')
    {
        // Check admin permission
        if(!current_user_can('manage_options')) {
            echo json_encode(['success' => false, 'msg' => 'Không có quyền truy cập']);
            die();
        }
        $this->verify_admin_ajax_nonce();
        
        if ($key === '') {
            $key = isset($_POST['key']) ? sanitize_text_field(wp_unslash($_POST['key'])) : '';
        }
        
        $data = get_option($key, false);
        
        if($key != 'mbb_gw_login') {
            $data = $data ? json_decode($data, true) : null;
        }

        echo json_encode(['success' => 1, 'msg' => 'Thành công!', 'data' => $data]);
        die();
    }

    public function save_option($key = '', $data = '')
    {
        if(!current_user_can('manage_options')) {
            echo json_encode(['success' => 0, 'msg' => 'Không có quyền truy cập!']);
            die();
        }
        $this->verify_admin_ajax_nonce();

        if ($key === '') {
            $key = isset($_POST['key']) ? sanitize_text_field(wp_unslash($_POST['key'])) : '';
        }
        if ($data === '' || $data === null) {
            $data = $this->parse_ajax_settings_payload();
        }

        if (!$key || !is_array($data)) {
            echo json_encode(['success' => 0, 'msg' => 'Thiếu thông tin bắt buộc!']);
            die();
        }

        try {
            // Sanitize data based on key
            if ($key === 'mbb_gw_settings') {
                $existing_raw = get_option($key, false);
                $existing = [];
                if (is_string($existing_raw) && $existing_raw !== '') {
                    $decoded_existing = json_decode($existing_raw, true);
                    if (is_array($decoded_existing)) {
                        $existing = $decoded_existing;
                    }
                }
                $merged = array_replace_recursive($existing, $data);
                $data = Mbbank_Mh_Validator::sanitize_settings($merged);
            } elseif ($key === 'mbb_gw_login') {
                // Validate access token
                if (isset($data['access_token'])) {
                    try {
                        $data['access_token'] = Mbbank_Mh_Validator::validate_access_token($data['access_token']);
                    } catch (Exception $e) {
                        echo json_encode(['success' => 0, 'msg' => $e->getMessage()]);
                        die();
                    }
                }
                $data = $this->encode_($data);
            }

            $json_data = json_encode($data);
            if ($json_data === false) {
                Mbbank_Mh_Logger::error('save_option', 'JSON encoding failed', ['key' => $key]);
                echo json_encode(['success' => 0, 'msg' => 'Lỗi mã hóa dữ liệu!']);
                die();
            }

            $option = get_option($key, false);
            if( $option ) {
               $result = update_option($key, $json_data);
            } else {
               $result = add_option( $key, $json_data, '', false);
            }

            $verify_save = get_option($key, false);
            $is_data_same = ($verify_save === $json_data);
            
            if (!$result && !$is_data_same) {
                delete_option($key);
                $force_result = add_option($key, $json_data, '', false);
                
                if (!$force_result) {
                    echo json_encode(['success' => 0, 'msg' => 'Không thể lưu vào database! Vui lòng kiểm tra quyền database.']);
                    die();
                }
            }

            $saved_data = get_option($key, false);
            echo json_encode(['success' => 1, 'msg' => 'Lưu dữ liệu thành công!', 'data' => json_decode($saved_data)]);
            
        } catch (Exception $e) {
            echo json_encode(['success' => 0, 'msg' => 'Lỗi hệ thống: ' . $e->getMessage()]);
        }
        die();
    }

    public function add_gateway_class( $gateways ) {
        $gateways[] = 'Mbb_Gateway_MH'; // your class name is here
        return $gateways;
    }

    public function init_gateway_class() {
        include MBB_MH_PATH . "admin/mbbank-gateway.php";
    }

    public function add_admin_pages()
    {
        $icon = MBB_MH_URL . 'public/images/mbbank.png';
        add_menu_page(
            __( 'MBBank GateWay', 'textdomain' ),
            'MBBank MH',
            'manage_options',
            'mbb_gateway_mh',
            [$this, 'admin_template'],
            $icon,
            110
        );
    }

    /**
     * Make API call with retry logic
     *
     * @param string $endpoint API endpoint
     * @param array $payload Request payload
     * @param array $headers Request headers
     * @param int $attempt Current attempt number
     * @return string API response
     */
    private function make_api_call_with_retry($endpoint, $payload, $headers, $attempt = 1) {
        $ch = curl_init($endpoint);
        
        // SSL verification - enable in production, allow disabling in debug mode
        $ssl_verify = !defined('WP_DEBUG') || !WP_DEBUG;
        
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_POSTFIELDS     => json_encode($payload),
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_SSL_VERIFYPEER => $ssl_verify,
            CURLOPT_SSL_VERIFYHOST => $ssl_verify ? 2 : 0,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 3,
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        // Check if we should retry
        $should_retry = ($err || $httpCode >= 500) && $attempt < self::MAX_API_RETRIES;
        
        if ($should_retry) {
            // Exponential backoff: 1s, 2s, 4s
            $delay = pow(2, $attempt - 1);
            Mbbank_Mh_Logger::warning('api_call', 'API call failed, retrying', [
                'attempt' => $attempt,
                'delay' => $delay,
                'http_code' => $httpCode,
                'error' => $err
            ]);
            sleep($delay);
            return $this->make_api_call_with_retry($endpoint, $payload, $headers, $attempt + 1);
        }

        if ($err) {
            Mbbank_Mh_Logger::error('api_call', 'cURL error after retries', ['error' => $err], Mbbank_Mh_Logger::ERROR_API_CALL);
            return json_encode(['success' => 0, 'msg' => 'Lỗi kết nối: ' . $err]);
        }

        if ($httpCode >= 400) {
            Mbbank_Mh_Logger::error('api_call', 'HTTP error', [
                'http_code' => $httpCode,
                'response' => substr($response, 0, 200)
            ], Mbbank_Mh_Logger::ERROR_API_CALL);
            return json_encode(['success' => 0, 'msg' => 'Lỗi HTTP: ' . $httpCode]);
        }

        return $response;
    }

    // Gọi API MBBank của bạn (thay thế API ACB cũ)
    public function call_mbbank_api($auth, $login = false, $filters = []){
        try {
            $endpoint = isset($this->settings['api']['endpoint']) ? trim($this->settings['api']['endpoint']) : '';
            if (empty($endpoint) || !filter_var($endpoint, FILTER_VALIDATE_URL)) {
                Mbbank_Mh_Logger::error('api_call', 'Invalid endpoint', ['endpoint' => $endpoint], Mbbank_Mh_Logger::ERROR_API_CALL);
                return json_encode(['success' => 0, 'msg' => 'Chưa cấu hình API endpoint hợp lệ']);
            }
            
            // Validate auth data
            if (!is_array($auth)) {
                return json_encode(['success' => 0, 'msg' => 'Dữ liệu xác thực không hợp lệ']);
            }
            
            // Validate required auth fields
            if ($login && (empty($auth['username']) || empty($auth['password']))) {
                return json_encode(['success' => 0, 'msg' => 'Thiếu thông tin đăng nhập']);
            }

        // Payload khác nhau cho login vs lấy giao dịch
        if ($login) {
            // Payload cho login/authentication
            $payload = [
                'username' => $auth['username'] ?? '',
                'password' => $auth['password'] ?? '',
                'deviceId' => 'web_' . time(),
                'clientId' => 'mbbank_plugin'
            ];
            
            // Có thể cần endpoint khác cho login
            if (strpos($endpoint, '/transactions') !== false) {
                $endpoint = str_replace('/transactions', '/login', $endpoint);
            }
        } else {
            // Payload cho lấy giao dịch
            // Default: lấy 7 ngày qua (backward compatible)
            // Smart sync: lấy chỉ hôm nay với filters
            $payload = [
                'from_date' => $filters['from_date'] ?? gmdate('Y-m-d', strtotime('-7 days')),
                'to_date'   => $filters['to_date'] ?? gmdate('Y-m-d'),
            ];
            
            // Add smart filter parameters if provided
            if (!empty($filters['description_contains'])) {
                $payload['description_contains'] = $filters['description_contains'];
            }
            if (isset($filters['min_amount'])) {
                $payload['min_amount'] = floatval($filters['min_amount']);
            }
            if (isset($filters['max_amount'])) {
                $payload['max_amount'] = floatval($filters['max_amount']);
            }
            if (isset($filters['limit'])) {
                $payload['limit'] = intval($filters['limit']);
            }
            if (isset($filters['sort_order'])) {
                $payload['sort_order'] = $filters['sort_order'];
            }
            
            // API không cần account_no, tự động filter theo auth
            // Account number được cấu hình riêng trong settings để đối soát
        }

        $headers = ['Content-Type: application/json'];
        if (!empty($auth['access_token'])) {
            $headers[] = 'Authorization: Bearer ' . $auth['access_token'];
        }

            // Use retry mechanism for API calls
            $response = $this->make_api_call_with_retry($endpoint, $payload, $headers);
            
            // Check if response is already an error JSON
            $decoded_check = json_decode($response, true);
            if (isset($decoded_check['success']) && $decoded_check['success'] === 0) {
                return $response; // Already an error response
            }

            if (empty($response)) {
                Mbbank_Mh_Logger::error('api_call', 'Empty response from API', [], Mbbank_Mh_Logger::ERROR_API_CALL);
                return json_encode(['success' => 0, 'msg' => 'API không trả về dữ liệu']);
            }

            $data = json_decode($response, true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                error_log("MBBank MH: JSON decode error: " . json_last_error_msg());
                return json_encode(['success' => 0, 'msg' => 'Dữ liệu API không hợp lệ']);
            }
            
            if (isset($data['success']) && isset($data['results'])) {
                return $response;
            }
            
            // Chuẩn hóa về format chung (cho các API khác)
            $results = array_map(function($t){
                if (!is_array($t)) return null;
                return [
                    'transactionNumber' => $t['id'] ?? $t['reference'] ?? $t['transactionNumber'] ?? '',
                    'amount'            => floatval($t['amount'] ?? 0),
                    'description'       => $t['description'] ?? '',
                    'type'              => strtoupper($t['direction'] ?? $t['type'] ?? 'IN'),
                ];
            }, $data['transactions'] ?? $data['results'] ?? []);

            // Filter out null results
            $results = array_filter($results, function($item) {
                return $item !== null;
            });

            return json_encode(['success' => 1, 'results' => array_values($results)]);
            
        } catch (Exception $e) {
            error_log("MBBank MH: API call error: " . $e->getMessage());
            return json_encode(['success' => 0, 'msg' => 'Lỗi hệ thống: ' . $e->getMessage()]);
        }
    }

    private function get_encryption_key() {
        // Use WordPress salts for encryption key
        $key = wp_salt('secure_auth') . wp_salt('nonce_key');
        return substr(hash('sha256', $key), 0, 32);
    }
    
    public function get_transaction_table() {
        return $this->transaction_table;
    }
    
    private function create_tables_if_not_exist() {
        global $wpdb;
        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        
        $table_prefix = $wpdb->prefix;
        
        $sqls = [
            "CREATE TABLE {$table_prefix}mbb_gateway_cron (
                 id int(11) NOT NULL AUTO_INCREMENT,
                 time datetime NOT NULL,
                 json text,
                 PRIMARY KEY (id),
                 KEY time (time)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8",
            "CREATE TABLE {$table_prefix}mbb_gateway_transactions (
                 id int(11) NOT NULL AUTO_INCREMENT,
                 tranId varchar(50) NOT NULL,
                 partnerName varchar(255) DEFAULT NULL,
                 amount decimal(20,2) NOT NULL DEFAULT 0.00,
                 comment text,
                 description text,
                 partnerId varchar(50) DEFAULT NULL,
                 status int(11) DEFAULT 1,
                 ownerName varchar(255) DEFAULT NULL,
                 ownerNumber varchar(20) DEFAULT NULL,
                 ackTime datetime DEFAULT NULL,
                 ipAddress varchar(45) DEFAULT NULL,
                 order_id int(11) DEFAULT NULL,
                 is_paid tinyint(1) DEFAULT 0,
                 PRIMARY KEY (id),
                 UNIQUE KEY tranId (tranId),
                 KEY order_id (order_id),
                 KEY is_paid (is_paid),
                 KEY order_paid (order_id, is_paid)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8",
            "CREATE TABLE {$table_prefix}mbb_gateway_locks (
                 lock_key varchar(191) NOT NULL,
                 locked_at datetime NOT NULL,
                 expires_at datetime NOT NULL,
                 PRIMARY KEY (lock_key),
                 KEY expires_at (expires_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8"
        ];
        
        foreach ($sqls as $sql) {
            dbDelta($sql);
        }
        
        $this->tables_verified = true;
    }

    /**
     * Acquire an atomic lock using database
     *
     * @param int $order_id Order ID to lock
     * @return bool True if lock acquired, false otherwise
     */
    private function acquire_lock($order_id) {
        global $wpdb;
        
        // Ensure tables exist
        if (!$this->tables_verified) {
            $this->verify_tables();
        }
        
        $lock_key = 'payment_' . absint($order_id);
        $now = current_time('mysql');
        $expires_at = gmdate('Y-m-d H:i:s', strtotime('+' . self::LOCK_TIMEOUT . ' seconds'));
        
        // Clean up expired locks first
        $this->cleanup_expired_locks();
        
        // Try to insert lock - atomic operation
        $result = $wpdb->query(
            $wpdb->prepare(
                "INSERT IGNORE INTO {$this->locks_table} (lock_key, locked_at, expires_at) VALUES (%s, %s, %s)",
                $lock_key,
                $now,
                $expires_at
            )
        );
        
        if ($result === 1) {
            Mbbank_Mh_Logger::debug('lock_acquisition', 'Lock acquired', ['order_id' => $order_id]);
            return true;
        }
        
        Mbbank_Mh_Logger::debug('lock_acquisition', 'Lock already exists', ['order_id' => $order_id]);
        return false;
    }

    /**
     * Release a lock
     *
     * @param int $order_id Order ID to unlock
     * @return void
     */
    private function release_lock($order_id) {
        global $wpdb;
        
        if (!$this->tables_verified) {
            return;
        }
        
        $lock_key = 'payment_' . absint($order_id);
        
        $wpdb->delete(
            $this->locks_table,
            ['lock_key' => $lock_key],
            ['%s']
        );
        
        Mbbank_Mh_Logger::debug('lock_release', 'Lock released', ['order_id' => $order_id]);
    }

    /**
     * Clean up expired locks
     *
     * @return void
     */
    private function cleanup_expired_locks() {
        global $wpdb;
        
        if (!$this->tables_verified) {
            return;
        }
        
        $now = current_time('mysql');
        
        $wpdb->query(
            $wpdb->prepare(
                "DELETE FROM {$this->locks_table} WHERE expires_at < %s",
                $now
            )
        );
    }

    /**
     * Verify tables exist, create if needed
     *
     * @return void
     */
    private function verify_tables() {
        global $wpdb;
        
        $locks_exists = $wpdb->get_var("SHOW TABLES LIKE '{$this->locks_table}'");
        
        if (!$locks_exists) {
            $this->create_tables_if_not_exist();
        } else {
            $this->tables_verified = true;
        }
    }

    /**
     * Rate limiting for AJAX endpoints
     *
     * @param string $action Action name
     * @param int $max_requests Maximum requests allowed
     * @param int $time_window Time window in seconds
     * @return bool True if allowed, false if rate limit exceeded
     */
    private function check_rate_limit($action, $max_requests = 10, $time_window = 60) {
        // Get user IP for rate limiting
        $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
        $user_id = get_current_user_id();
        
        // Create unique key for this action + IP/user
        $key = 'mbbank_rate_limit_' . md5($action . $ip . $user_id);
        
        $requests = get_transient($key);
        
        if ($requests === false) {
            // First request in this time window
            set_transient($key, 1, $time_window);
            return true;
        }
        
        if ($requests >= $max_requests) {
            Mbbank_Mh_Logger::warning('rate_limit', 'Rate limit exceeded', [
                'action' => $action,
                'ip' => $ip,
                'user_id' => $user_id,
                'requests' => $requests
            ]);
            return false;
        }
        
        // Increment counter
        set_transient($key, $requests + 1, $time_window);
        return true;
    }

    private function encode_($data){
        // Encrypt sensitive data using WordPress native encryption
        $json_data = json_encode($data);
        
        // Use openssl encryption with WordPress salts
        $key = $this->get_encryption_key();
        $iv = openssl_random_pseudo_bytes(16);
        
        $encrypted = openssl_encrypt($json_data, 'AES-256-CBC', $key, 0, $iv);
        
        // Combine IV + encrypted data and encode
        return base64_encode($iv . $encrypted);
    }

    private function decode_($encrypted_data){
        try {
            $key = $this->get_encryption_key();
            $data = base64_decode($encrypted_data);
            
            if (strlen($data) < 16) {
                throw new Exception('Invalid encrypted data length');
            }
            
            // Extract IV and encrypted content
            $iv = substr($data, 0, 16);
            $encrypted = substr($data, 16);
            
            $decrypted = openssl_decrypt($encrypted, 'AES-256-CBC', $key, 0, $iv);
            
            if ($decrypted === false) {
                throw new Exception('Decryption failed');
            }
            
            return json_decode($decrypted, true);
            
        } catch (Exception $e) {
            if (is_string($encrypted_data)) {
                return json_decode($encrypted_data, true);
            }
            return null;
        }
    }

    public function getInbetweenStrings($start, $end, $str){
        $start = strtolower($start);
        $end = strtolower($end);
        $str = strtolower($str);
        $matches = array();
        $regex = "/$start([a-zA-Z0-9]*)$end/";
        preg_match_all($regex, $str, $matches);
        return $matches[1];
    }

    public function admin_template()
    {
         require_once MBB_MH_PATH . 'admin/partials/' . $this->plugin_name . '-admin-display.php';
    }

    /**
     * Register the stylesheets for the admin area.
     *
     * @since    1.0.0
     */
    public function enqueue_styles() {
        wp_enqueue_style( $this->plugin_name, plugin_dir_url( __FILE__ ) . '../admin/css/mbbank-mh-admin.css', array(), $this->version, 'all' );
    }

    /**
     * Register the JavaScript for the admin area.
     *
     * @since    1.0.0
     */
    public function enqueue_scripts() {
        // wp_enqueue_script( $this->plugin_name, plugin_dir_url( __FILE__ ) . '../admin/js/mbbank-mh-admin.js', array( 'jquery' ), $this->version, false );
    }
}
