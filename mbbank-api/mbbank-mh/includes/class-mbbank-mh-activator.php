<?php

/**
 * Fired during plugin activation
 *
 * @link       https://dominhhai.com/
 * @since      1.0.0
 *
 * @package    Mbbank_Mh
 * @subpackage Mbbank_Mh/includes
 */

/**
 * Fired during plugin activation.
 *
 * This class defines all code necessary to run during the plugin's activation.
 *
 * @since      1.0.0
 * @package    Mbbank_Mh
 * @subpackage Mbbank_Mh/includes
 * @author     MH Developer <dev@example.com>
 */
class Mbbank_Mh_Activator {

    /**
     * Short Description. (use period)
     *
     * Long Description.
     *
     * @since    1.0.0
     */
    public static function activate() {
        global $wpdb;
        require_once( ABSPATH . 'wp-admin/includes/upgrade.php' );
        
        // Fix table names with proper prefix
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
            dbDelta( $sql );
        }
        
        // Create default settings if not exist
        if (!get_option('mbb_gw_settings')) {
            $default_settings = [
                'account' => [
                    'number' => '',
                    'name' => '',
                    'bin' => '970422' // MBBank BIN
                ],
                'prefix' => 'DH',
                'subfix' => '',
                'order_status' => 'processing',
                'create_order_status' => 'pending',
                'currency_rate' => 1,
                'qr_template' => 'https://api.vietqr.io/{BIN}/{ACC}/{AMT}/{NOTE}/qr_only.jpg',
                'api' => [
                    'endpoint' => ''
                ],
                'notify' => [
                    'payment_gateway_label' => 'Thanh toán online với MBBank',
                    'method_description' => 'Quét mã QR hoặc chuyển khoản theo hướng dẫn bên dưới.',
                    'order_completed' => 'Thanh toán thành công! Cảm ơn bạn đã mua hàng.'
                ],
                'reload_after_completed' => false
            ];
            add_option('mbb_gw_settings', json_encode($default_settings), '', false);
        }
        
        // Schedule cron jobs during activation
        // Clear any existing schedules first
        wp_clear_scheduled_hook('mbbank_smart_sync');
        wp_clear_scheduled_hook('mbbank_cleanup_orders');
        wp_clear_scheduled_hook('mbbank_sync_hook');
        
        // Register custom intervals temporarily for activation
        add_filter('cron_schedules', function($schedules) {
            $schedules['every_30_seconds'] = [
                'interval' => 30,
                'display'  => __('Every 30 Seconds')
            ];
            $schedules['every_15_minutes'] = [
                'interval' => 900,
                'display'  => __('Every 15 Minutes')
            ];
            return $schedules;
        });
        
        // Schedule new cron jobs
        wp_schedule_event(time(), 'every_30_seconds', 'mbbank_smart_sync');
        wp_schedule_event(time(), 'every_15_minutes', 'mbbank_cleanup_orders');
    }
}
