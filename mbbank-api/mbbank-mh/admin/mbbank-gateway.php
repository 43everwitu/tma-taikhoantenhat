<?php 
    
    class Mbb_Gateway_MH extends WC_Payment_Gateway {

            /**
             * Class constructor, more about it in Step 3
             */
            public $mbb_gw_settings = [];
            protected $default_settings = [
                'notify' => [
                    'payment_gateway_label' => 'Thanh toán MBBank',
                    'method_description' => 'Thanh toán online với MBBank',
                    'order_completed' => 'Thanh toán thành công!',
                ],
            ];
            public function __construct() {

                $raw_settings = get_option('mbb_gw_settings', '');
                
                if (!empty($raw_settings)) {
                    $decoded_settings = json_decode($raw_settings, true);
                    if (json_last_error() === JSON_ERROR_NONE && is_array($decoded_settings)) {
                        $this->mbb_gw_settings = array_replace_recursive($this->default_settings, $decoded_settings);
                    } else {
                        $this->mbb_gw_settings = $this->default_settings;
                    }
                } else {
                    $this->mbb_gw_settings = $this->default_settings;
                }
                $this->id = 'mbbank-gateway-mh'; // payment gateway plugin ID
                $this->icon = MBB_MH_URL . "public/images/vietqr-logo.svg"; // VietQR logo displayed on checkout page
                $this->has_fields = true; // in case you need a custom credit card form
                $this->method_title = 'MBBank Gateway MH';
                $this->method_description = 'Thanh toán online với MBBank'; // will be displayed on the options page


                // gateways can support subscriptions, refunds, saved payment methods,
                // but in this tutorial we begin with simple payments
                $this->supports = array(
                    'products'
                );

                // Method with all the options fields
                $this->init_form_fields();

                // Load the settings.
                $this->init_settings();
                
                
                $this->title = !empty($this->mbb_gw_settings['notify']['payment_gateway_label']) 
                    ? $this->mbb_gw_settings['notify']['payment_gateway_label'] 
                    : 'Thanh toán MBBank';
                $this->description = !empty($this->mbb_gw_settings['notify']['method_description']) 
                    ? $this->mbb_gw_settings['notify']['method_description'] 
                    : 'Thanh toán online với MBBank';
                $this->enabled = $this->get_option( 'enabled' );

                // This action hook saves the settings
                add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'process_admin_options' ) );

                // We need custom JavaScript to obtain a token
                add_action( 'wp_enqueue_scripts', array( $this, 'payment_scripts' ) );
            
                 add_action( 'woocommerce_thankyou', array( $this, 'thankyou_page' ), 4 );

            }
    
            /**
             * Plugin options, we deal with it in Step 3 too
             */
            public function init_form_fields(){

                $this->form_fields = array(
                'enabled' => array(
                    'title'       => 'Bật/Tắt',
                    'label'       => 'Bật thanh toán MBBank',
                    'type'        => 'checkbox',
                    'description' => '',
                    'default'     => 'no'
                ),
                'title' => array(
                    'title' => __( 'Tên Cổng Thanh Toán', 'woocommerce' ),
                    'type' => 'text',
                    'description' => __( 'Tên cổng thanh toán mà người dùng sẽ thấy khi thanh toán', 'woocommerce' ),
                    'default' => 'Thanh toán online với MBBank, dành cho chuyển tiền nội địa và liên ngân hàng',
                    'desc_tip'      => true,
                ),
                'description' => array(
                    'title' => __( 'Mô Tả Cho Khách', 'woocommerce' ),
                    'type' => 'textarea',
                    'description' => __( 'Đoạn mô tả giúp khách hiểu rõ hơn cách thức thanh toán', 'woocommerce' ),
                    'default' => 'Hãy mở App Ngân hàng của bạn lên và nhấn Đặt Hàng để quét mã thanh toán'
                ),
                
            );

        
            }

            /**
             * You will need it if you want your custom credit card form, Step 4 is about it
             */
            public function payment_fields() {
                $method_description = isset($this->mbb_gw_settings['notify']['method_description']) 
                    ? $this->mbb_gw_settings['notify']['method_description'] 
                    : 'Thanh toán online với MBBank';
                echo '<div> ' . esc_html($method_description) . '</div>';
                //  Output an image
                echo '<div><img style="width:80%; padding-top: 20px; display:block; margin-left: auto; margin-right: auto;" src="' . esc_url(MBB_MH_URL . 'public/images/banks.png') . '" alt="Các ngân hàng hỗ trợ thanh toán"></div>';
            }
            

            /*
             * Custom CSS and JS, in most cases required only when you decided to go with a custom credit card form
             */
            public function payment_scripts() {
                // Load scripts on checkout and thank you pages
                if ( ! is_cart() && ! is_checkout() && ! is_wc_endpoint_url('order-received') ) {
                    return;
                }

                // if our payment gateway is disabled, we do not have to enqueue JS too
                if ( 'no' === $this->enabled ) {
                    return;
                }

                // Add preconnect for Google Fonts (performance optimization)
                add_action('wp_head', function() {
                    echo '<link rel="preconnect" href="https://fonts.googleapis.com">';
                    echo '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>';
                }, 1);

                // Enqueue jQuery (should already be loaded by WordPress)
                wp_enqueue_script('jquery');
                
                // External JS file disabled - using inline scripts instead
                
                // Enqueue SweetAlert2
                wp_enqueue_script(
                    'sweetalert2',
                    MBB_MH_URL . 'public/js/sweetalert2.all.min.js',
                    array(),
                    '1.0.1',
                    true
                );
                
                // Enqueue SweetAlert2 CSS
                wp_enqueue_style(
                    'sweetalert2-css',
                    MBB_MH_URL . 'public/css/sweetalert2.css',
                    array(),
                    '1.0.1'
                );
                
                // Enqueue our custom CSS with version for cache busting
                wp_enqueue_style(
                    'mbbank-mh-public',
                    MBB_MH_URL . 'public/css/mbbank-mh-public.css',
                    array(),
                    '1.0.1'
                );
            }

            /*
             * Fields validation, more in Step 5
             */
            public function validate_fields() {

                return true;

            }

            /*
             * We're processing the payments here, everything about it is in Step 5
             */
            public function process_payment( $order_id ) {
                $order = wc_get_order( $order_id );
                            
                    // Mark as on-hold (we're awaiting the payment)
                    // $order->update_status( 'on-hold', __( 'Awaiting offline payment', 'wc-gateway-offline' ) );
                    if(isset($this->mbb_gw_settings['create_order_status']) && $this->mbb_gw_settings['create_order_status'])
                            $order->update_status( $this->mbb_gw_settings['create_order_status'] ); 
                    // Reduce stock levels
                    wc_reduce_stock_levels($order_id);
                    // Remove cart
                    WC()->cart->empty_cart();
                            
                    // Return thankyou redirect
                    return array(
                        'result'    => 'success',
                        'redirect'  => $this->get_return_url( $order )
                    );

            }

            /*
             * In case you need a webhook, like PayPal IPN etc
             */
            public function webhook() {

            
                        
            }

            
            
            public function thankyou_page( $order_id ) {
                global $wpdb;
                $order = wc_get_order($order_id);
                
                if (!$order instanceof WC_Order) {
                    return;
                }

                if ($order->get_payment_method() !== $this->id) {
                    return;
                }
                
                $total = (float) $order->get_total();

                $sotien = 'Số tiền:';
                $currency_rate = isset($this->mbb_gw_settings['currency_rate']) ? (float) $this->mbb_gw_settings['currency_rate'] : 0.0;
                if ($currency_rate > 0) {
                    $total = (float) round($total * $currency_rate);
                    $sotien = 'Số tiền quy đổi VNĐ:';
                }

                // Validate and sanitize payment data
                $account_settings = $this->mbb_gw_settings['account'] ?? [];
                $phone = isset($account_settings['number']) ? sanitize_text_field($account_settings['number']) : '';
                $prefix = isset($this->mbb_gw_settings['prefix']) ? sanitize_text_field($this->mbb_gw_settings['prefix']) : '';
                $subfix = isset($this->mbb_gw_settings['subfix']) ? sanitize_text_field($this->mbb_gw_settings['subfix']) : '';
                $note = trim($prefix . $order_id . $subfix);
                
                if (empty($phone)) {
                    error_log("MBBank MH: Missing account number for order #{$order_id}");
                    $phone = '0000000000'; // Fallback to prevent errors
                }
                
                // MBBank BIN code is 970422
                $bin = isset($account_settings['bin']) ? sanitize_text_field($account_settings['bin']) : '970422';
                $qrTemplate = isset($this->mbb_gw_settings['qr_template']) ? $this->mbb_gw_settings['qr_template'] : 'https://api.vietqr.io/{BIN}/{ACC}/{AMT}/{NOTE}/qr_only.jpg';
                
                // Ensure QR template is valid
                if (empty($qrTemplate) || strpos($qrTemplate, '{BIN}') === false) {
                    $qrTemplate = 'https://api.vietqr.io/{BIN}/{ACC}/{AMT}/{NOTE}/qr_only.jpg';
                }
                
                // Save original template for debug
                $originalTemplate = $qrTemplate;
                
                $qrCode = str_replace(
                    ['{BIN}', '{ACC}', '{AMT}', '{NOTE}'],
                    [$bin, $phone, $total, $note],
                    $qrTemplate
                );
                
                // Now sanitize the final URL
                $qrCode = esc_url_raw($qrCode);

                $table_info = $this->resolve_transaction_table($wpdb);
                $transaction_table = $table_info['name'];
                $transaction_table_exists = $table_info['exists'];
                
                $isCompleted = null;

                if ($order->has_status('completed')) {
                    if ($transaction_table_exists) {
                        $sql_any = $wpdb->prepare("SELECT * FROM {$transaction_table} WHERE order_id = %d", $order_id);
                        $any_transaction = $wpdb->get_row($sql_any, ARRAY_A);
                        if ($any_transaction) {
                            $isCompleted = $any_transaction;
                        }
                    }

                    if (!$isCompleted) {
                        $isCompleted = [
                            'order_id' => $order_id,
                            'is_paid' => 1,
                            'status' => 'completed',
                            'source' => 'woocommerce',
                        ];
                    }
                } elseif ($transaction_table_exists) {
                    $sql = $wpdb->prepare("SELECT * FROM {$transaction_table} WHERE order_id = %d AND is_paid = 1", $order_id);
                    $isCompleted = $wpdb->get_row($sql, ARRAY_A);
                }
                
                // Check if debug mode is enabled
                $debug_enabled = !empty($this->mbb_gw_settings['debug']['enabled']);
                
                // Debug info (remove after fixing)
                if ($debug_enabled) {
                    error_log("[MBBank Debug] Order ID: $order_id");
                    error_log("[MBBank Debug] Table name: $transaction_table (exists: " . ($transaction_table_exists ? 'yes' : 'no') . ')');
                    error_log("[MBBank Debug] WC Order status: " . $order->get_status());
                    error_log("[MBBank Debug] isCompleted result: " . print_r($isCompleted, true));
                    error_log("[MBBank Debug] QR Template BEFORE replace: $originalTemplate");
                    error_log("[MBBank Debug] BIN: $bin, Phone: $phone, Total: $total, Note: $note");
                    error_log("[MBBank Debug] QR Code AFTER replace: $qrCode");
                }
            
                ?>
                <script src="<?php echo MBB_MH_URL ?>/public/js/sweetalert2.all.min.js" ></script>
                <link rel="stylesheet" href="<?php echo MBB_MH_URL ?>/public/css/sweetalert2.css"/>

                <script>
                    /**
                     * Modern Toast Notification System
                     */
                    function showMBBankToast(title, message, type = 'success', duration = 3000) {
                        const container = document.getElementById('mbbank-toast-container');
                        if (!container) return;
                        
                        const icons = {
                            success: '✓',
                            error: '✕',
                            info: 'ℹ',
                            warning: '⚠'
                        };
                        
                        const toast = document.createElement('div');
                        toast.className = `mbbank-toast mbbank-toast-${type}`;
                        toast.style.position = 'relative';
                        toast.style.overflow = 'hidden';
                        
                        toast.innerHTML = `
                            <div class="mbbank-toast-icon">${icons[type] || icons.info}</div>
                            <div class="mbbank-toast-content">
                                <div class="mbbank-toast-title">${title}</div>
                                ${message ? `<div class="mbbank-toast-message">${message}</div>` : ''}
                            </div>
                            <button class="mbbank-toast-close" onclick="this.parentElement.classList.add('hide')">×</button>
                            ${duration > 0 ? `<div class="mbbank-toast-progress" style="width: 100%;"></div>` : ''}
                        `;
                        
                        container.appendChild(toast);
                        
                        // Trigger animation
                        setTimeout(() => toast.classList.add('show'), 10);
                        
                        // Auto dismiss with progress bar
                        if (duration > 0) {
                            const progressBar = toast.querySelector('.mbbank-toast-progress');
                            if (progressBar) {
                                progressBar.style.transition = `width ${duration}ms linear`;
                                setTimeout(() => progressBar.style.width = '0%', 50);
                            }
                            
                            setTimeout(() => {
                                toast.classList.add('hide');
                                setTimeout(() => toast.remove(), 400);
                            }, duration);
                        }
                    }
                    
                    async function downloadQR(qrUrl) {
                        try {
                            // Validate URL
                            if (!qrUrl || typeof qrUrl !== 'string') {
                                throw new Error('URL không hợp lệ');
                            }
                            
                            // Hiển thị loading toast
                            showMBBankToast('Đang tải xuống...', 'Vui lòng đợi một chút', 'info', 0);

                            // Add timeout for fetch
                            const controller = new AbortController();
                            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
                            
                            // Fetch ảnh từ URL
                            const response = await fetch(qrUrl, {
                                signal: controller.signal,
                                headers: {
                                    'Accept': 'image/*'
                                }
                            });
                            
                            clearTimeout(timeoutId);
                            
                            if (!response.ok) {
                                throw new Error(`Không thể tải ảnh QR (${response.status})`);
                            }

                            // Chuyển thành blob
                            const blob = await response.blob();
                            
                            // Tạo URL object từ blob
                            const blobUrl = window.URL.createObjectURL(blob);
                            
                            // Tạo link download
                            const link = document.createElement('a');
                            link.href = blobUrl;
                            link.download = 'ma-qr-thanh-toan-<?php echo esc_js($order_id); ?>.jpg';
                            
                            // Thêm vào DOM, click và remove
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                            
                            // Cleanup blob URL
                            window.URL.revokeObjectURL(blobUrl);
                            
                            // Remove loading toast
                            const container = document.getElementById('mbbank-toast-container');
                            if (container) {
                                const loadingToast = container.querySelector('.mbbank-toast-info');
                                if (loadingToast) loadingToast.remove();
                            }
                            
                            // Hiển thị thông báo thành công
                            showMBBankToast('Tải xuống thành công!', 'Mã QR đã được lưu vào thiết bị của bạn', 'success', 3000);
                            
                        } catch (error) {
                            // Remove loading toast
                            const container = document.getElementById('mbbank-toast-container');
                            if (container) {
                                const loadingToast = container.querySelector('.mbbank-toast-info');
                                if (loadingToast) loadingToast.remove();
                            }
                            
                            let errorMessage = 'Vui lòng thử lại';
                            
                            if (error.name === 'AbortError') {
                                errorMessage = 'Quá thời gian chờ. Kiểm tra kết nối mạng';
                            } else if (error.message) {
                                errorMessage = error.message;
                            }
                            
                            showMBBankToast('Lỗi tải xuống', errorMessage, 'error', 4000);
                        }
                    }
                </script>

                <!-- Debug info (only shown when debug mode is enabled) -->
                <?php if ($debug_enabled): ?>
                <div id="mbbank-debug" style="display: none; background: #f5f5f5; border: 1px solid #ddd; padding: 15px; margin: 20px 0; border-radius: 4px; font-family: monospace; font-size: 12px;">
                    <strong style="display: block; margin-bottom: 10px; color: #d63638;">🐛 Debug Information</strong>
                    <strong>Order ID:</strong> <?php echo $order_id; ?><br>
                    <strong>Table:</strong> <?php echo $transaction_table; ?><br>
                    <strong>WC Status:</strong> <?php echo $order->get_status(); ?><br>
                    <strong>Is Completed:</strong> <?php echo ($isCompleted || $order->has_status('completed')) ? 'YES' : 'NO'; ?><br>
                    <?php
                        $api_endpoint = $this->mbb_gw_settings['api']['endpoint'] ?? '';
                        $api_endpoint_host = '';
                        if (is_string($api_endpoint) && $api_endpoint !== '') {
                            $parsed = wp_parse_url($api_endpoint);
                            $api_endpoint_host = $parsed && isset($parsed['host']) ? $parsed['host'] : $api_endpoint;
                        }
                        $has_login = get_option('mbb_gw_login', false) ? 'YES' : 'NO';
                        $order_sync_lock_key = 'mbbank_sync_scheduled_' . intval($order_id);
                        $global_pull_key = 'mbbank_waiting_payment_api_pull';
                        $order_sync_locked = get_transient($order_sync_lock_key) ? 'YES' : 'NO';
                        $global_pull_locked = get_transient($global_pull_key) ? 'YES' : 'NO';
                        $last_sync_attempt_at = get_transient('mbbank_last_sync_attempt_at');
                        $last_sync_error = get_transient('mbbank_last_sync_error');
                    ?>
                    <strong>API Endpoint URL (full):</strong> <?php echo esc_html($api_endpoint); ?><br>
                    <strong>API Endpoint Host:</strong> <?php echo esc_html($api_endpoint_host); ?><br>
                    <strong>API Token Saved (mbb_gw_login):</strong> <?php echo esc_html($has_login); ?><br>
                    <strong>Order Sync Transient Locked:</strong> <?php echo esc_html($order_sync_locked); ?><br>
                    <strong>Global Pull Transient Locked:</strong> <?php echo esc_html($global_pull_locked); ?><br>
                    <strong>Last Sync Attempt:</strong> <?php echo esc_html($last_sync_attempt_at ?: 'N/A'); ?><br>
                    <strong>Last Sync Error:</strong> <?php echo esc_html($last_sync_error ?: 'NONE'); ?><br>
                    <strong>QR Template (BEFORE):</strong> <?php echo esc_html($originalTemplate); ?><br>
                    <strong>QR Code (AFTER):</strong> <?php echo esc_html($qrCode); ?><br>
                    <strong>BIN:</strong> <?php echo $bin; ?><br>
                    <strong>Account:</strong> <?php echo $phone; ?><br>
                    <strong>Total:</strong> <?php echo number_format($total); ?> ₫<br>
                    <strong>Note:</strong> <?php echo esc_html($note); ?><br>
                    <strong>Timestamp:</strong> <?php echo current_time('Y-m-d H:i:s'); ?>
                </div>
                
                <!-- Debug toggle button -->
                <div style="text-align: center; margin: 10px 0;">
                    <button onclick="document.getElementById('mbbank-debug').style.display = document.getElementById('mbbank-debug').style.display === 'none' ? 'block' : 'none';" style="background: #f0f0f0; border: 1px solid #ccc; padding: 8px 15px; cursor: pointer; font-size: 12px; border-radius: 3px;">
                        🐛 Toggle Debug Info
                    </button>
                </div>
                <?php endif; ?>
                
                <!-- Toast Container -->
                <div id="mbbank-toast-container"></div>
                
                <div id="mbbank-gateway">
                    <?php if ($isCompleted || $order->has_status('completed')): ?>
                        <div class="mbbank-gateway-result">
                            <div class="swal2-icon swal2-success swal2-icon-show" style="display: flex; margin: 0 auto 20px;">
                                <span class="swal2-success-line-tip" style="background-color: #a5dc86;"></span>
                                <span class="swal2-success-line-long" style="background-color: #a5dc86;"></span>
                            </div>
                            <div class="text-center"><?php echo isset($this->mbb_gw_settings['notify']['order_completed']) ? wp_kses_post($this->mbb_gw_settings['notify']['order_completed']) : 'Thanh toán thành công!' ?></div>
                        </div>
                    <?php else: ?>
                    
                    <!-- Order Summary Header -->
                    <div id="payment-info">
                        <div id="left-col">
                            <div class="mbbank-payment-steps">
                                <div class="mbbank-step-item">
                                    <div class="mbbank-step-number">1</div>
                                    <div class="mbbank-step-text">Mở Ví điện tử/Ngân hàng</div>
                                </div>
                                <div class="mbbank-step-item">
                                    <div class="mbbank-step-number">2</div>
                                    <div class="mbbank-step-text">Chọn <img src="<?php echo MBB_MH_URL  ?>/public/images/qr.svg" style="width: 20px; height: 20px; margin: 0 5px;" /> và quét mã</div>
                                </div>
                                <div class="mbbank-step-item">
                                    <div class="mbbank-step-number">3</div>
                                    <div class="mbbank-step-text">Xác Nhận Chuyển Khoản</div>
                                </div>
                            </div>
                            
                            <div class="mbbank-qr-section">
                                <img class="mbbank-qr-image" 
                                     src="<?php echo $qrCode ?>" 
                                     alt="QR Code thanh toán" 
                                     loading="eager"
                                     onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
                                <div style="display:none; text-align:center; padding:20px; border:1px solid #ddd; border-radius:8px; background:#f8f9fa;">
                                    <p style="color:#dc3545; font-weight:600; margin-bottom:8px;">⚠️ Không thể tải QR Code</p>
                                    <small style="color:#6c757d;">Vui lòng kiểm tra kết nối mạng hoặc liên hệ hỗ trợ</small>
                                    <?php if (defined('WP_DEBUG') && WP_DEBUG): ?>
                                    <br><small style="color:#999; font-size:10px;">URL: <?php echo esc_html($qrCode) ?></small>
                                    <?php endif; ?>
                                </div>
                                <button class="mbbank-download-btn" onclick="downloadQR('<?php echo esc_js($qrCode) ?>')">
                                    <img src="<?php echo MBB_MH_URL  ?>/public/images/download.svg" width="16" alt="" />
                                    Tải xuống QR
                                </button>
                            </div>
                        </div>
                        
                        <div id="right-col">
                            <div class="mbbank-account-info">
                                <div class="mbbank-account-header">
                                    <div class="mbbank-account-title">THÔNG TIN CHUYỂN KHOẢN</div>
                                    <div class="mbbank-bank-subtitle">Hỗ trợ Ví điện tử MoMo/ZaloPay<br/>Hoặc ứng dụng ngân hàng để chuyển khoản nhanh 24/7</div>
                                </div>
                                
                                <div class="mbbank-account-details">
                                    <div style="padding: 12px 16px; font-weight: bold; font-size: 16px; text-align: center; color: #495057;">
                                        <?php echo isset($this->mbb_gw_settings['account']['name']) ? esc_html($this->mbb_gw_settings['account']['name']) : 'Chủ tài khoản' ?>
                                    </div>
                                    
                                    <table>
                                        <tbody>
                                            <tr>
                                                <th>Ngân Hàng:</th>
                                                <th>
                                                    <img src="<?php echo MBB_MH_URL  ?>/public/images/mbbank-logo.png" alt="MBBank" style="max-width: 150px;" />
                                                </th>
                                            </tr>
                                            <tr>
                                                <th>Tài Khoản:</th>
                                                <th>
                                                    <span><?php echo esc_html($phone) ?></span>
                                                    <button class="mbbank-copy-btn" data-c="<?php echo esc_attr($phone) ?>" title="Sao chép">
                                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                                        </svg>
                                                    </button>
                                                </th>
                                            </tr>
                                            <tr>
                                                <th>Số Tiền:</th>
                                                <th>
                                                    <span class="mbbank-amount-value"><?php echo number_format(floatval($total)) ?> ₫</span>
                                                    <button class="mbbank-copy-btn" data-c="<?php echo esc_attr($total) ?>" title="Sao chép">
                                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                                        </svg>
                                                    </button>
                                                </th>
                                            </tr>
                                            <tr>
                                                <th>Nội Dung<span style="color: red;">*</span>:</th>
                                                <th>
                                                    <span class="mbbank-content-copy" id="nd"><?php echo esc_html($note) ?></span>
                                                    <button class="mbbank-copy-btn" data-c="<?php echo esc_attr($note) ?>" title="Sao chép">
                                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                                        </svg>
                                                    </button>
                                                </th>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            
                            <div class="mbbank-payment-warning">
                                Vui lòng <strong>nhập chính xác nội dung, thanh toán xong vui lòng không tắt trình duyệt cho tới khi đơn hàng được xác nhận.</strong>
                            </div>
                            
                            <div class="mbbank-loading-container">
                                <img src="<?php echo MBB_MH_URL ?>/public/images/loading.svg" class="mbbank-loading-icon">
                                <div id="payment-status-text" style="text-align: center; margin-top: 10px; color: #666; font-size: 14px;">
                                    Đang chờ thanh toán...
                                </div>
                            </div>
                        </div>
                    </div>
                    <?php
                        $frontend_settings = [
                            'ajax_url' => admin_url('admin-ajax.php'),
                            'plugin_url' => MBB_MH_URL,
                            'notify' => $this->mbb_gw_settings['notify'] ?? [],
                            'reload_after_completed' => $this->mbb_gw_settings['reload_after_completed'] ?? true,
                            'url_redirect' => $this->mbb_gw_settings['url_redirect'] ?? '',
                            // Polling configuration from backend
                            'polling' => [
                                'initial_delay' => Mbbank_Mh_Admin::POLLING_INITIAL_DELAY,
                                'interval_phase1' => Mbbank_Mh_Admin::POLLING_INTERVAL_PHASE1,
                                'interval_phase2' => Mbbank_Mh_Admin::POLLING_INTERVAL_PHASE2,
                                'interval_phase3' => Mbbank_Mh_Admin::POLLING_INTERVAL_PHASE3,
                                'phase1_end' => Mbbank_Mh_Admin::POLLING_PHASE1_END,
                                'phase2_end' => Mbbank_Mh_Admin::POLLING_PHASE2_END,
                                'max_time' => Mbbank_Mh_Admin::POLLING_MAX_TIME,
                            ],
                            'rate_limit' => [
                                'max_requests' => Mbbank_Mh_Admin::RATE_LIMIT_WAITING_MAX,
                                'window' => Mbbank_Mh_Admin::RATE_LIMIT_WAITING_WINDOW,
                            ],
                            // Debug mode
                            'debug' => [
                                'enabled' => !empty($this->mbb_gw_settings['debug']['enabled']),
                            ],
                        ];
                        $frontend_settings_json = esc_attr(wp_json_encode($frontend_settings));
                    ?>
                    <input type="hidden" id="mbb-gateway-nonce" value="<?php echo esc_attr(wp_create_nonce('check-payment_' . $order_id)); ?>">
                    <input type="hidden" id="mbb-gateway-order_id" value="<?php echo esc_attr($order_id); ?>">
                    <input type="hidden" id="mbb-gateway-order_key" value="<?php echo esc_attr($order->get_order_key()); ?>">
                    <input type="hidden" id="mbb-gateway-order_status" value="<?php echo esc_attr($order->get_status()); ?>">
                    <input type="hidden" id="mbb-gateway-settings" data-settings='<?php echo $frontend_settings_json; ?>'>
                    
                    <script>
                        /**
                         * MBBank Payment Monitoring System
                         * ================================
                         * 
                         * Optimized polling strategy for customer payment behavior:
                         * 
                         * TIMELINE (configurable from backend):
                         * 0-5 min:   Poll every 20s (15 requests)
                         * 5-15 min:  Poll every 60s (10 requests)
                         * 15-30 min: Poll every 5 min (3 requests)
                         * 
                         * TOTAL REQUESTS IN 30 MINUTES:
                         * - 0-5min:   ~15 requests (every 20s)
                         * - 5-15min:  ~10 requests (every 60s)
                         * - 15-30min: ~3 requests (every 5min)
                         * = ~28 requests total in 30 minutes (~0.93 req/min average)
                         * 
                         * All timing is controlled by backend configuration.
                         * 
                         * IIFE Isolation: Each order page has its own execution context.
                         */
                        (function() {
                            // Isolated state for this order (no global pollution)
                            var ORDER_ID = <?php echo intval($order_id); ?>;
                            var paymentCompleted = false;
                            var pollCount = 0;
                            var pollStartTime = Date.now();
                            var rateLimitWarned = false;
                            var pollingConfig = null;
                            var debugEnabled = <?php echo $debug_enabled ? 'true' : 'false'; ?>;
                            
                            // Page Visibility & Activity tracking
                            var isTabVisible = !document.hidden;
                            var lastUserActivity = Date.now();
                            var userInactive = false;
                            var missedPollsWhileHidden = 0;
                            
                            // Error handling
                            var consecutiveErrors = 0;
                            var maxConsecutiveErrors = 5;
                            
                            // Debug logger
                            function debugLog(message, data) {
                                if (debugEnabled && window.console && console.log) {
                                    if (data) {
                                        console.log('[MBBank Debug Order #' + ORDER_ID + '] ' + message, data);
                                    } else {
                                        console.log('[MBBank Debug Order #' + ORDER_ID + '] ' + message);
                                    }
                                }
                            }
                        
                            /**
                             * Get polling configuration from backend settings
                             */
                            function getPollingConfig() {
                                if (pollingConfig) {
                                    return pollingConfig;
                                }
                                
                                // Try to load from settings
                                var settings = (typeof $ !== 'undefined' && $("#mbb-gateway-settings").data("settings"));
                                
                                if (settings && settings.polling) {
                                    pollingConfig = {
                                        initial_delay: (settings.polling.initial_delay || 30) * 1000,
                                        interval_phase1: (settings.polling.interval_phase1 || 20) * 1000,
                                        interval_phase2: (settings.polling.interval_phase2 || 60) * 1000,
                                        interval_phase3: (settings.polling.interval_phase3 || 300) * 1000,
                                        phase1_end: (settings.polling.phase1_end || 300) * 1000,
                                        phase2_end: (settings.polling.phase2_end || 900) * 1000,
                                        max_time: (settings.polling.max_time || 1800) * 1000
                                    };
                                } else {
                                    // Fallback defaults
                                    pollingConfig = {
                                        initial_delay: 30000,    // 30s
                                        interval_phase1: 20000,  // 20s
                                        interval_phase2: 60000,  // 60s
                                        interval_phase3: 300000, // 5min
                                        phase1_end: 300000,      // 5min
                                        phase2_end: 900000,      // 15min
                                        max_time: 1800000        // 30min
                                    };
                                }
                                
                                return pollingConfig;
                            }
                            
                            /**
                             * Smart polling delay based on elapsed time, tab visibility, and user activity
                             * Uses configuration from backend and adapts to user behavior
                             */
                            function getSmartPollingDelay() {
                                var config = getPollingConfig();
                                var elapsed = Date.now() - pollStartTime;
                                var baseDelay;
                                
                                // Calculate base delay based on phase
                                if (elapsed < config.phase1_end) {
                                    baseDelay = config.interval_phase1; // 0-5 min: 20s
                                } else if (elapsed < config.phase2_end) {
                                    baseDelay = config.interval_phase2; // 5-15 min: 60s
                                } else {
                                    baseDelay = config.interval_phase3; // 15+ min: 300s
                                }
                                
                                // Adaptive behavior: Tab visibility
                                if (!isTabVisible) {
                                    missedPollsWhileHidden++;
                                    debugLog('Tab hidden - reducing poll frequency 3x', {
                                        baseDelay: baseDelay / 1000 + 's',
                                        newDelay: (baseDelay * 3) / 1000 + 's'
                                    });
                                    return baseDelay * 3; // Tab hidden: slow down 3x
                                }
                                
                                // Adaptive behavior: User activity
                                var timeSinceActivity = Date.now() - lastUserActivity;
                                if (timeSinceActivity > 300000) { // 5 minutes
                                    if (!userInactive) {
                                        userInactive = true;
                                        debugLog('User inactive >5min - increasing minimum delay to 2min');
                                    }
                                    return Math.max(baseDelay, 120000); // Min 2 minutes when inactive
                                }
                                
                                // Normal active user with visible tab
                                return baseDelay;
                            }
                            
                            // Đảm bảo jQuery được load hoặc fallback vanilla JS
                            function waitForJQuery(callback) {
                                if (typeof jQuery !== 'undefined') {
                                    callback(jQuery);
                                } else if (typeof $ !== 'undefined') {
                                    callback($);
                                } else {
                                    // Fallback: load jQuery nếu chưa có
                                    const script = document.createElement('script');
                                    script.src = 'https://code.jquery.com/jquery-3.6.0.min.js';
                                    script.onload = function() {
                                        callback(jQuery.noConflict());
                                    };
                                    document.head.appendChild(script);
                                }
                            }
                            
                            function initMBBankPayment() {
                                // Setup Page Visibility API
                                document.addEventListener('visibilitychange', function() {
                                    if (document.hidden) {
                                        isTabVisible = false;
                                        debugLog('Tab became hidden - polling will slow down');
                                    } else {
                                        isTabVisible = true;
                                        debugLog('Tab became visible - resuming normal polling');
                                        
                                        // Check immediately when tab becomes visible again
                                        if (!paymentCompleted && missedPollsWhileHidden > 0) {
                                            debugLog('Catching up after ' + missedPollsWhileHidden + ' missed polls');
                                            missedPollsWhileHidden = 0;
                                            // Will check on next scheduled poll
                                        }
                                    }
                                });
                                
                                // Setup User Activity Detection
                                var activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
                                activityEvents.forEach(function(eventName) {
                                    document.addEventListener(eventName, function() {
                                        lastUserActivity = Date.now();
                                        if (userInactive) {
                                            userInactive = false;
                                            debugLog('User became active again - resuming normal polling');
                                        }
                                    }, { passive: true });
                                });
                                
                                waitForJQuery(function($) {
                                    var settings = $("#mbb-gateway-settings").data("settings");
                                    
                                    if (settings) {
                                        $("#mbb-gateway-settings").data("settings", settings);
                                        $("#mbb-gateway-settings").attr("data-settings", JSON.stringify(settings));
                                    } else {
                                        settings = {
                                            ajax_url: '<?php echo esc_js(admin_url('admin-ajax.php')); ?>',
                                            plugin_url: '<?php echo esc_js(MBB_MH_URL); ?>',
                                            notify: { order_completed: 'Thanh toán thành công!' },
                                            reload_after_completed: true,
                                            url_redirect: ''
                                        };
                                        $("#mbb-gateway-settings").data("settings", settings);
                                        $("#mbb-gateway-settings").attr("data-settings", JSON.stringify(settings));
                                    }
                                    
                                    loadMBBankScript($);
                                });
                            }
                            
                            function loadMBBankScript($) {
                                // Copy functionality
                                $(".mbbank-copy-btn").on("click", function (e) {
                                e.preventDefault();
                                var textToCopy = $(this).data("c");

                                if (navigator.clipboard) {
                                    navigator.clipboard.writeText(textToCopy).then(function () {
                                        showCopySuccess();
                                    });
                                } else {
                                    var textArea = document.createElement("textarea");
                                    textArea.value = textToCopy;
                                    document.body.appendChild(textArea);
                                    textArea.select();
                                    document.execCommand("copy");
                                    document.body.removeChild(textArea);
                                    showCopySuccess();
                                }
                            });

                            function showCopySuccess() {
                                showMBBankToast("Đã sao chép!", "Nội dung đã được sao chép vào clipboard", "success", 2000);
                            }

                            function handlePaymentSuccess(message, shouldReload) {
                                var content = message || "Cảm ơn bạn đã thanh toán";
                                var reloadAfter = shouldReload !== false;
                                if (typeof Swal !== "undefined") {
                                    var swalPromise = Swal.fire({
                                        icon: "success",
                                        title: "Thanh toán thành công!",
                                        html: content,
                                        confirmButtonText: "OK",
                                        allowOutsideClick: false,
                                        allowEscapeKey: false
                                    });
                                    if (reloadAfter) {
                                        swalPromise.then(function () {
                                            window.location.href = window.location.href + (window.location.href.indexOf('?') > -1 ? '&' : '?') + '_mbbank_refresh=' + Date.now();
                                        });
                                    }
                                } else {
                                    alert(content);
                                    if (reloadAfter) {
                                        window.location.href = window.location.href + (window.location.href.indexOf('?') > -1 ? '&' : '?') + '_mbbank_refresh=' + Date.now();
                                    }
                                }
                            }

                            function handlePaymentFailure(message, status) {
                                var statusLabel = status ? " (trạng thái: " + status + ")" : "";
                                var content = message || "Đơn hàng hiện không thể tiếp tục" + statusLabel;
                                if (typeof Swal !== "undefined") {
                                    Swal.fire({
                                        icon: "error",
                                        title: "Thông báo",
                                        html: content,
                                        confirmButtonText: "OK",
                                        allowOutsideClick: false,
                                        allowEscapeKey: false
                                    });
                                } else {
                                    alert(content);
                                }
                            }

                            function checkPaymentStatus() {
                                // Prevent double execution
                                if (paymentCompleted) {
                                    return;
                                }
                                
                                var config = getPollingConfig();
                                var elapsed = Date.now() - pollStartTime;
                                
                                // Check if polling has exceeded max time
                                if (elapsed > config.max_time) {
                                    var maxMinutes = Math.floor(config.max_time / 60000);
                                    debugLog('Polling timeout reached (' + maxMinutes + ' minutes)');
                                    var statusText = $("#payment-status-text");
                                    if (statusText.length) {
                                        statusText.text('Hết thời gian chờ. Vui lòng liên hệ hỗ trợ nếu đã thanh toán.');
                                        statusText.css('color', '#f39c12');
                                    }
                                    return;
                                }
                                
                                // Update status text to show we're checking
                                var statusText = $("#payment-status-text");
                                if (statusText.length && pollCount > 0) {
                                    var elapsedSeconds = Math.floor(elapsed / 1000);
                                    var minutes = Math.floor(elapsedSeconds / 60);
                                    var seconds = elapsedSeconds % 60;
                                    var timeStr = minutes > 0 ? minutes + 'p' + seconds + 's' : elapsedSeconds + 's';
                                    statusText.text('Đang kiểm tra thanh toán... (' + timeStr + ')');
                                }
                                
                                var orderId = $("#mbb-gateway-order_id").val();
                                var orderKey = $("#mbb-gateway-order_key").val();
                                var nonce = $("#mbb-gateway-nonce").val();
                                var settings = $("#mbb-gateway-settings").data("settings") ||
                                             JSON.parse($("#mbb-gateway-settings").attr("data-settings") || '{}');

                                if (!orderId || (!nonce && !orderKey)) return;
                                
                                if (!settings || !settings.ajax_url) {
                                    settings = settings || {};
                                    settings.ajax_url = '<?php echo esc_js(admin_url('admin-ajax.php')); ?>';
                                }
                                
                                pollCount++;

                                $.ajax({
                                    url: settings.ajax_url,
                                    type: "GET",
                                    data: {
                                        action: "mbb_gw_waiting_payment",
                                        order_id: orderId,
                                        order_key: orderKey,
                                        nonce: nonce,
                                    },
                                    success: function (response) {
                                        if (paymentCompleted) {
                                            return;
                                        }
                                        
                                        // Reset error counter on successful response
                                        consecutiveErrors = 0;

                                        var rawStatus = response && response.status ? String(response.status) : null;
                                        var status = rawStatus ? rawStatus.toLowerCase() : null;
                                        var message = response && response.msg ? response.msg : null;
                                        var lowerMsg = message ? String(message).toLowerCase() : '';

                                        if (lowerMsg.indexOf('invalid security token') !== -1) {
                                            paymentCompleted = true;
                                            var stAuth = $("#payment-status-text");
                                            if (stAuth.length) {
                                                stAuth.text('Phiên thanh toán không hợp lệ hoặc đã hết hạn. Vui lòng tải lại trang.');
                                                stAuth.css('color', '#dc3545');
                                            }
                                            if (typeof showMBBankToast === 'function') {
                                                showMBBankToast('Lỗi xác thực', 'Vui lòng tải lại trang thanh toán (F5).', 'error', 5000);
                                            }
                                            debugLog('Stopped polling: invalid security token');
                                            return;
                                        }

                                        if (rawStatus) {
                                            $("#mbb-gateway-order_status").val(rawStatus);
                                        }

                                        if (response && response.success) {
                                            paymentCompleted = true;
                                            handlePaymentSuccess(message);
                                            return;
                                        }

                                        if (status && ['completed', 'processing'].indexOf(status) !== -1) {
                                            paymentCompleted = true;
                                            handlePaymentSuccess(message);
                                            return;
                                        }

                                        if (status && ['cancelled', 'failed', 'refunded', 'trash'].indexOf(status) !== -1) {
                                            paymentCompleted = true;
                                            handlePaymentFailure(message, rawStatus);
                                            return;
                                        }

                                        // Handle rate limiting gracefully
                                        if (response && response.rate_limited) {
                                            // If rate limited, use smart delay + 10s buffer (increased from 5s)
                                            var delay = getSmartPollingDelay() + 10000;
                                            debugLog('Rate limited, next check in ' + (delay / 1000) + 's');
                                            
                                            // Update status text
                                            var statusText = $("#payment-status-text");
                                            if (statusText.length) {
                                                statusText.text('Đang kiểm tra thanh toán... (vui lòng đợi)');
                                            }
                                            
                                            setTimeout(checkPaymentStatus, delay);
                                            return;
                                        }

                                        if (message && message.length) {
                                            lowerMsg = message.toLowerCase();
                                            if (!rateLimitWarned && lowerMsg.indexOf('too many requests') !== -1) {
                                                rateLimitWarned = true;
                                                showMBBankToast("Vui lòng đợi thêm chút", "Hệ thống đang kiểm tra thanh toán...", "info", 2500);
                                                debugLog('Too many requests warning shown');
                                            }
                                        }

                                        // Use smart polling delay based on elapsed time
                                        var delay = getSmartPollingDelay();
                                        if (pollCount <= 3) {
                                            debugLog('Next check in ' + (delay / 1000) + 's (poll #' + pollCount + ')');
                                        }
                                        setTimeout(checkPaymentStatus, delay);
                                    },
                                    error: function (xhr, status, error) {
                                        if (!paymentCompleted) {
                                            consecutiveErrors++;
                                            
                                            // Exponential backoff: 5s → 10s → 20s → 40s → 80s
                                            var errorBackoff = Math.min(5000 * Math.pow(2, consecutiveErrors - 1), 80000);
                                            var delay = getSmartPollingDelay() + errorBackoff;
                                            
                                            debugLog('AJAX error #' + consecutiveErrors + ', retrying in ' + (delay / 1000) + 's', {
                                                status: status,
                                                error: error,
                                                backoff: errorBackoff / 1000 + 's'
                                            });
                                            
                                            // Update status text
                                            var statusText = $("#payment-status-text");
                                            if (statusText.length) {
                                                if (consecutiveErrors >= maxConsecutiveErrors) {
                                                    statusText.text('Lỗi kết nối. Vui lòng kiểm tra lại trong admin.');
                                                    statusText.css('color', '#dc3545');
                                                } else {
                                                    statusText.text('Đang thử lại... (' + consecutiveErrors + '/' + maxConsecutiveErrors + ')');
                                                }
                                            }
                                            
                                            if (consecutiveErrors < maxConsecutiveErrors) {
                                                setTimeout(checkPaymentStatus, delay);
                                            } else {
                                                debugLog('Max consecutive errors reached - stopping auto-retry');
                                            }
                                        }
                                    },
                                });
                            }

                            // Only start checking if order is not already completed
                            if (
                                $("#mbb-gateway-order_id").length > 0 &&
                                $(".mbbank-gateway-result").length === 0 &&
                                !paymentCompleted
                            ) {
                                // Check if order is already completed in WooCommerce
                                var orderStatus = $("#mbb-gateway-order_status").val();
                                if (orderStatus === 'completed' || orderStatus === 'processing') {
                                    // Order is already completed, show success immediately
                                    paymentCompleted = true;
                                    handlePaymentSuccess("Cảm ơn bạn đã thanh toán", false);
                                } else {
                                    // Start checking payment status with initial delay from config
                                    // Customer needs time to read info, open banking app, scan QR
                                    var config = getPollingConfig();
                                    var initialDelaySeconds = config.initial_delay / 1000;
                                    debugLog('Order #' + ORDER_ID + ': Starting payment monitoring. First check in ' + initialDelaySeconds + 's...');
                                    debugLog('Order #' + ORDER_ID + ': Polling schedule: 0-5min=' + (config.interval_phase1/1000) + 's, 5-15min=' + (config.interval_phase2/1000) + 's, 15+min=' + (config.interval_phase3/1000) + 's');
                                    setTimeout(checkPaymentStatus, config.initial_delay);
                                }
                            }
                        }
                        
                        // Khởi tạo khi DOM ready
                        if (document.readyState === 'loading') {
                            document.addEventListener('DOMContentLoaded', initMBBankPayment);
                        } else {
                            initMBBankPayment();
                        }
                        })(); // Close IIFE
                    </script>
                    <?php endif ?>
                </div>

                
            <?php
            
        }

        /**
         * Resolve the transaction table name once per request.
         *
         * @param \wpdb $wpdb
         * @return array{name:string, exists:bool}
         */
        private function resolve_transaction_table($wpdb) {
            static $cache = null;

            if (null !== $cache) {
                return $cache;
            }

            $prefixed = $wpdb->prefix . 'mbb_gateway_transactions';
            if ($this->table_exists($wpdb, $prefixed)) {
                $cache = [
                    'name' => $prefixed,
                    'exists' => true,
                ];
                return $cache;
            }

            $plain = 'mbb_gateway_transactions';
            if ($this->table_exists($wpdb, $plain)) {
                $cache = [
                    'name' => $plain,
                    'exists' => true,
                ];
                return $cache;
            }

            $cache = [
                'name' => $prefixed,
                'exists' => false,
            ];

            return $cache;
        }

        /**
         * Check if a database table exists using a LIKE comparison.
         *
         * @param \wpdb  $wpdb
         * @param string $table_name
         * @return bool
         */
        private function table_exists($wpdb, $table_name) {
            $pattern = str_replace(['_', '%'], ['\\_', '\\%'], $table_name);
            $pattern = esc_sql($pattern);

            $result = $wpdb->get_var("SHOW TABLES LIKE '{$pattern}'");

            return !empty($result);
        }
    }
