<?php
/**
 * Plugin Name:       MBBank Gateway - MH
 * Plugin URI:        mbbank-mh
 * Description:       Cổng thanh toán MBBank cho WooCommerce (không mã hóa).
 * Version:           1.0.0
 * Author:            MH Developer
 * Author URI:        https://dominhhai.com/
 * License:           GPL-2.0+
 * License URI:       http://www.gnu.org/licenses/gpl-2.0.txt
 * Text Domain:       mbbank-mh
 * Domain Path:       /languages
 */

if ( ! defined( 'MBB_MH_URL' ) ) {
    define('MBB_MH_URL', plugin_dir_url( __FILE__ ) );
}
if ( ! defined( 'MBB_MH_PATH' ) ) {
    define('MBB_MH_PATH', plugin_dir_path( __FILE__ ) );
}

// If this file is called directly, abort.
if ( ! defined( 'WPINC' ) ) {
    die;
}

/**
 * Currently plugin version.
 */
define( 'MBB_MH_VERSION', '1.0.0' );

/**
 * The code that runs during plugin activation.
 */
function activate_mbbank_mh() {
    require_once plugin_dir_path( __FILE__ ) . 'includes/class-mbbank-mh-activator.php';
    Mbbank_Mh_Activator::activate();
}

/**
 * The code that runs during plugin deactivation.
 */
function deactivate_mbbank_mh() {
    // Unschedule all cron jobs
    wp_clear_scheduled_hook('mbbank_smart_sync');
    wp_clear_scheduled_hook('mbbank_cleanup_orders');
    wp_clear_scheduled_hook('mbbank_sync_hook');
    
    // Clean up old cron log data
    global $wpdb;
    $table_name = $wpdb->prefix . 'mbb_gateway_cron';
    $wpdb->query($wpdb->prepare(
        "DELETE FROM {$table_name} WHERE time < DATE_SUB(NOW(), INTERVAL 7 DAY)"
    ));
}

register_activation_hook( __FILE__, 'activate_mbbank_mh' );
register_deactivation_hook( __FILE__, 'deactivate_mbbank_mh' );

/**
 * Begins execution of the plugin.
 */
function run_mbbank_mh() {
    // Load core utility classes first
    require_once plugin_dir_path( __FILE__ ) . 'includes/class-mbbank-mh-logger.php';
    require_once plugin_dir_path( __FILE__ ) . 'includes/class-mbbank-mh-validator.php';
    
    // Load main classes
    require_once plugin_dir_path( __FILE__ ) . 'includes/class-mbbank-mh-admin.php';
    require_once plugin_dir_path( __FILE__ ) . 'includes/class-mbbank-mh-public.php';

    // Initialize admin functionality
    new Mbbank_Mh_Admin('mbbank-mh', MBB_MH_VERSION);
    
    // Initialize public functionality
    $public = new Mbbank_Mh_Public('mbbank-mh', MBB_MH_VERSION);
    add_action('wp_enqueue_scripts', [$public, 'enqueue_styles']);
    add_action('wp_enqueue_scripts', [$public, 'enqueue_scripts']);
}

add_action('plugins_loaded', 'run_mbbank_mh');
