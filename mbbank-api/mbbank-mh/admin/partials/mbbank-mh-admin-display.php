<?php

/**
 * Provide a admin area view for the plugin
 *
 * This file is used to markup the admin-facing aspects of the plugin.
 *
 * @link       https://dominhhai.com/
 * @since      1.0.0
 *
 * @package    Mbbank_Mh
 * @subpackage Mbbank_Mh/admin/partials
 */
?>

<div class="wrap">
    <h1><?php echo esc_html(get_admin_page_title()); ?></h1>
    
    <div id="mbbank-admin-app">
        <div class="nav-tab-wrapper">
            <a href="#settings" class="nav-tab nav-tab-active" id="settings-tab">Cấu hình</a>
            <a href="#transactions" class="nav-tab" id="transactions-tab">Giao dịch</a>
            <a href="#login" class="nav-tab" id="login-tab">API Token</a>
        </div>

        <!-- Settings Tab -->
        <div id="settings-content" class="tab-content active">
            <div class="postbox">
                <h3 class="hndle"><span>Cấu hình cơ bản</span></h3>
                <div class="inside">
                    <form id="settings-form">
                        <table class="form-table">
                            <tr>
                                <th scope="row">
                                    <label for="account_number">Số tài khoản MBBank</label>
                                </th>
                                <td>
                                    <input type="text" id="account_number" name="account[number]" class="regular-text" />
                                    <p class="description">Số tài khoản MBBank nhận tiền</p>
                                </td>
                            </tr>
                            <tr>
                                <th scope="row">
                                    <label for="account_name">Tên chủ tài khoản</label>
                                </th>
                                <td>
                                    <input type="text" id="account_name" name="account[name]" class="regular-text" />
                                    <p class="description">Tên hiển thị trên trang thanh toán</p>
                                </td>
                            </tr>
                            <tr>
                                <th scope="row">
                                    <label for="prefix">Prefix nội dung</label>
                                </th>
                                <td>
                                    <input type="text" id="prefix" name="prefix" class="regular-text" value="DH" />
                                    <p class="description">Tiền tố trong nội dung chuyển khoản (ví dụ: DH)</p>
                                </td>
                            </tr>
                            <tr>
                                <th scope="row">
                                    <label for="subfix">Suffix nội dung</label>
                                </th>
                                <td>
                                    <input type="text" id="subfix" name="subfix" class="regular-text" />
                                    <p class="description">Hậu tố trong nội dung chuyển khoản (có thể để trống)</p>
                                </td>
                            </tr>
                            <tr>
                                <th scope="row">
                                    <label for="order_status">Trạng thái đơn sau thanh toán</label>
                                </th>
                                <td>
                                    <select id="order_status" name="order_status">
                                        <option value="processing">Processing</option>
                                        <option value="completed">Completed</option>
                                        <option value="on-hold">On Hold</option>
                                    </select>
                                </td>
                            </tr>
                            <tr>
                                <th scope="row">
                                    <label for="currency_rate">Tỉ giá quy đổi</label>
                                </th>
                                <td>
                                    <input type="number" id="currency_rate" name="currency_rate" class="small-text" value="1" step="0.01" />
                                    <p class="description">Tỉ giá quy đổi (mặc định = 1)</p>
                                </td>
                            </tr>
                            <tr>
                                <th scope="row">
                                    <label for="api_endpoint">API Endpoint</label>
                                </th>
                                <td>
                                    <input type="url" id="api_endpoint" name="api[endpoint]" class="regular-text" />
                                    <p class="description">URL API MBBank của bạn (dựa trên <a href="https://github.com/thedtvn/MBBank" target="_blank">MBBank lib</a>)</p>
                                </td>
                            </tr>
                        </table>
                        
                        <h3>Thông báo & UI</h3>
                        <table class="form-table">
                            <tr>
                                <th scope="row">
                                    <label for="payment_label">Tên cổng thanh toán</label>
                                </th>
                                <td>
                                    <input type="text" id="payment_label" name="notify[payment_gateway_label]" class="regular-text" />
                                </td>
                            </tr>
                            <tr>
                                <th scope="row">
                                    <label for="method_description">Mô tả phương thức</label>
                                </th>
                                <td>
                                    <textarea id="method_description" name="notify[method_description]" rows="3" class="large-text"></textarea>
                                </td>
                            </tr>
                            <tr>
                                <th scope="row">
                                    <label for="order_completed">Thông báo hoàn thành</label>
                                </th>
                                <td>
                                    <input type="text" id="order_completed" name="notify[order_completed]" class="regular-text" />
                                </td>
                            </tr>
                        </table>
                        
                        <h3>Cài đặt nâng cao</h3>
                        <table class="form-table">
                            <tr>
                                <th scope="row">
                                    <label for="debug_enabled">Chế độ Debug</label>
                                </th>
                                <td>
                                    <label>
                                        <input type="checkbox" id="debug_enabled" name="debug[enabled]" value="1" />
                                        Bật chế độ debug
                                    </label>
                                    <p class="description">Khi bật, sẽ hiển thị thông tin debug trên trang thanh toán và ghi log vào console. <strong>Chỉ nên bật khi cần kiểm tra lỗi.</strong></p>
                                </td>
                            </tr>
                            <tr>
                                <th scope="row">
                                    <label for="auto_reactivate_enabled">Tự động kích hoạt lại đơn hàng</label>
                                </th>
                                <td>
                                    <label>
                                        <input type="checkbox" id="auto_reactivate_enabled" name="auto_reactivate[enabled]" value="1" />
                                        Tự động kích hoạt lại đơn đã hủy khi phát hiện thanh toán muộn
                                    </label>
                                    <p class="description">Khi bật, nếu phát hiện thanh toán cho đơn hàng đã bị tự động hủy (do timeout), hệ thống sẽ tự động kích hoạt lại đơn hàng. <strong>Khuyến nghị: BẬT</strong></p>
                                </td>
                            </tr>
                            <tr>
                                <th scope="row">
                                    <label for="auto_reactivate_grace_period">Thời gian cho phép kích hoạt lại</label>
                                </th>
                                <td>
                                    <select id="auto_reactivate_grace_period" name="auto_reactivate[grace_period]">
                                        <option value="1800">30 phút</option>
                                        <option value="3600">1 giờ</option>
                                        <option value="7200">2 giờ</option>
                                        <option value="14400">4 giờ</option>
                                        <option value="28800">8 giờ</option>
                                        <option value="86400" selected>24 giờ (khuyến nghị)</option>
                                        <option value="259200">3 ngày</option>
                                        <option value="604800">7 ngày</option>
                                    </select>
                                    <p class="description">Nếu khách thanh toán sau khi đơn hàng bị hủy trong khoảng thời gian này, đơn sẽ tự động được kích hoạt lại. <strong>Mặc định: 24 giờ</strong></p>
                                </td>
                            </tr>
                            <tr>
                                <th scope="row">
                                    <label for="auto_cancel_timeout">Thời gian tự động hủy đơn</label>
                                </th>
                                <td>
                                    <select id="auto_cancel_timeout" name="auto_cancel[timeout]">
                                        <option value="900">15 phút</option>
                                        <option value="1800">30 phút</option>
                                        <option value="3600">60 phút (khuyến nghị)</option>
                                        <option value="7200">120 phút</option>
                                        <option value="0">Tắt tự động hủy</option>
                                    </select>
                                    <p class="description">Đơn hàng pending sẽ tự động bị hủy nếu không nhận được thanh toán sau khoảng thời gian này. <strong>Mặc định: 60 phút</strong></p>
                                </td>
                            </tr>
                        </table>

                        <p class="submit">
                            <input type="button" id="save-settings" class="button-primary" value="Lưu cấu hình" />
                            <span id="settings-status" class="spinner"></span>
                        </p>
                    </form>
                </div>
            </div>
        </div>

        <!-- Transactions Tab -->
        <div id="transactions-content" class="tab-content">
            <div class="postbox">
                <h3 class="hndle"><span>Danh sách giao dịch</span></h3>
                <div class="inside">
                    <div class="tablenav top">
                        <div class="alignleft actions">
                            <input type="button" id="sync-transactions" class="button" value="Đồng bộ giao dịch" />
                            <input type="button" id="reset-data" class="button button-secondary" value="Xóa tất cả dữ liệu" />
                        </div>
                    </div>
                    
                    <table class="wp-list-table widefat fixed striped">
                        <thead>
                            <tr>
                                <th>ID Giao dịch</th>
                                <th>Số tiền</th>
                                <th>Mô tả</th>
                                <th>Mã đơn hàng</th>
                                <th>Trạng thái</th>
                                <th>Thời gian</th>
                            </tr>
                        </thead>
                        <tbody id="transactions-list">
                            <tr>
                                <td colspan="6" class="text-center">Đang tải...</td>
                            </tr>
                        </tbody>
                    </table>
                    
                    <div id="transactions-pagination" class="tablenav bottom"></div>
                </div>
            </div>
        </div>

        <!-- Login Tab -->
        <div id="login-content" class="tab-content">
            <div class="postbox">
                <h3 class="hndle"><span>Cấu hình API MBBank</span></h3>
                <div class="inside">
                    <form id="login-form">
                        <table class="form-table">
                            <tr>
                                <th scope="row">
                                    <label for="access_token">Access Token <span style="color:red;">*</span></label>
                                </th>
                                <td>
                                    <textarea id="access_token" name="access_token" rows="4" class="large-text" placeholder="Nhập Bearer token từ MBBank API..."></textarea>
                                    <p class="description">
                                        <strong>Bearer token để truy cập MBBank API</strong><br>
                                        Ví dụ: <code>R-aZ3kFJ9qT7bPMX2wH8NdgC5LrYV-QtGmS4xZb71X9</code><br>
                                        API sẽ gọi với header: <code>Authorization: Bearer {token}</code>
                                    </p>
                                </td>
                            </tr>
                        </table>

                        <p class="submit">
                            <input type="button" id="test-api" class="button-primary" value="Test API Connection" />
                            <input type="button" id="save-login" class="button" value="Lưu cấu hình" />
                            <span id="login-status" class="spinner"></span>
                        </p>
                    </form>
                </div>
            </div>
        </div>
    </div>
</div>

<style>
.tab-content {
    display: none;
    margin-top: 20px;
}
.tab-content.active {
    display: block;
}
.nav-tab-wrapper {
    border-bottom: 1px solid #ccc;
}
.text-center {
    text-align: center;
}
.spinner.is-active {
    visibility: visible;
    float: none;
    margin-left: 10px;
}
</style>

<script type="text/javascript">
jQuery(document).ready(function($) {
    var ajaxUrl = '<?php echo admin_url('admin-ajax.php'); ?>';
    var adminNonce = '<?php echo wp_create_nonce('mbb_gw_admin_nonce'); ?>';
    var debugEnabled = false;

    // Hide test endpoints by default; show only when debug mode is enabled in admin.
    $('#test-api').hide();
    
    // Tab switching
    $('.nav-tab').on('click', function(e) {
        e.preventDefault();
        var target = $(this).attr('href');
        
        $('.nav-tab').removeClass('nav-tab-active');
        $(this).addClass('nav-tab-active');
        
        $('.tab-content').removeClass('active');
        $(target + '-content').addClass('active');
    });

    // Load settings on page load
    loadSettings();
    loadTransactions();
    loadApiConfig();

    function loadSettings() {
        $.post(ajaxUrl, {
            action: 'mbb_gw_get_option',
            key: 'mbb_gw_settings',
            nonce: adminNonce
        }, function(response) {
            try {
                if (typeof response === 'string') {
                    response = JSON.parse(response);
                }
                if (response.success && response.data) {
                    var data = response.data;
                    $('#account_number').val(data.account?.number || '');
                    $('#account_name').val(data.account?.name || '');
                    $('#prefix').val(data.prefix || 'DH');
                    $('#subfix').val(data.subfix || '');
                    $('#order_status').val(data.order_status || 'processing');
                    $('#currency_rate').val(data.currency_rate || 1);
                    $('#api_endpoint').val(data.api?.endpoint || '');
                    $('#payment_label').val(data.notify?.payment_gateway_label || '');
                    $('#method_description').val(data.notify?.method_description || '');
                    $('#order_completed').val(data.notify?.order_completed || '');
                    
                    // Advanced settings
                    debugEnabled = data.debug?.enabled || false;
                    $('#debug_enabled').prop('checked', debugEnabled);
                    if (debugEnabled) {
                        $('#test-api').show();
                    } else {
                        $('#test-api').hide();
                    }
                    $('#auto_reactivate_enabled').prop('checked', data.auto_reactivate?.enabled || false);
                    $('#auto_reactivate_grace_period').val(data.auto_reactivate?.grace_period || '86400');
                    $('#auto_cancel_timeout').val(data.auto_cancel?.timeout || '3600');
                }
            } catch (e) {
                // Silent fail
            }
        });
    }

    function loadTransactions() {
        $.ajax({
            url: ajaxUrl,
            type: 'POST',
            dataType: 'json',
            data: {
                action: 'mbb_gw_get_transactions',
                page: 1,
                per_page: 20,
                nonce: adminNonce
            },
            success: function(response) {
                if (typeof response === 'string' && response.length > 0) {
                    try {
                        response = JSON.parse(response);
                    } catch (e) {
                        return;
                    }
                }
                
                if (response && response.success) {
                    var html = '';
                    if (response.data && response.data.length > 0) {
                        $.each(response.data, function(i, item) {
                            html += '<tr>';
                            html += '<td>' + (item.tranId || '-') + '</td>';
                            html += '<td>' + number_format(item.amount) + ' ₫</td>';
                            html += '<td>' + (item.description || '-') + '</td>';
                            html += '<td>' + (item.order_id || '-') + '</td>';
                            html += '<td>' + (item.is_paid == 1 ? '<span style="color: green;">Đã thanh toán</span>' : '<span style="color: orange;">Chưa thanh toán</span>') + '</td>';
                            html += '<td>' + (item.ackTime || '-') + '</td>';
                            html += '</tr>';
                        });
                    } else {
                        html = '<tr><td colspan="6" class="text-center">Không có giao dịch nào</td></tr>';
                    }
                    $('#transactions-list').html(html);
                } else {
                    // Handle error case
                    var errorMsg = response && response.msg ? response.msg : 'Không thể tải danh sách giao dịch';
                    $('#transactions-list').html('<tr><td colspan="6" class="text-center" style="color: red;">Lỗi: ' + errorMsg + '</td></tr>');
                }
            },
            error: function(xhr, status, error) {
                // Handle AJAX error
                $('#transactions-list').html('<tr><td colspan="6" class="text-center" style="color: red;">Lỗi kết nối: ' + error + '</td></tr>');
            }
        });
    }

    function loadApiConfig() {
        $.post(ajaxUrl, {
            action: 'mbb_gw_get_option',
            key: 'mbb_gw_login',
            nonce: adminNonce
        }, function(response) {
            try {
                if (typeof response === 'string') {
                    response = JSON.parse(response);
                }
                if (response.success && response.data) {
                    var data = response.data;
                    $('#access_token').val(data.access_token || '');
                }
            } catch (e) {
                // Silent fail
            }
        });
    }

    function number_format(number) {
        return new Intl.NumberFormat('vi-VN').format(number);
    }

    // Save settings
    $('#save-settings').on('click', function() {
        var $btn = $(this);
        var $spinner = $('#settings-status');
        
        $btn.prop('disabled', true);
        $spinner.addClass('is-active');

        var formData = {};
        $('#settings-form').serializeArray().forEach(function(item) {
            var keys = item.name.split(/[\[\]]+/).filter(Boolean);
            var current = formData;
            for (var i = 0; i < keys.length - 1; i++) {
                if (!current[keys[i]]) current[keys[i]] = {};
                current = current[keys[i]];
            }
            current[keys[keys.length - 1]] = item.value;
        });
        formData.debug = { enabled: $('#debug_enabled').is(':checked') };
        formData.auto_reactivate = formData.auto_reactivate || {};
        formData.auto_reactivate.enabled = $('#auto_reactivate_enabled').is(':checked');
        formData.auto_reactivate.grace_period = $('#auto_reactivate_grace_period').val();
        formData.auto_cancel = formData.auto_cancel || {};
        formData.auto_cancel.timeout = $('#auto_cancel_timeout').val();

        $.ajax({
            url: ajaxUrl,
            type: 'POST',
            dataType: 'json',
            data: {
                action: 'mbb_gw_save_option',
                key: 'mbb_gw_settings',
                data_json: JSON.stringify(formData),
                nonce: adminNonce
            },
            success: function(response) {
                try {
                    if (typeof response === 'string') {
                        response = JSON.parse(response);
                    }
                    if (response.success) {
                        alert('Đã lưu cấu hình thành công!');
                        loadSettings();
                    } else {
                        alert('Có lỗi xảy ra: ' + (response.msg || 'Unknown error'));
                    }
                } catch (e) {
                    alert('Lỗi xử lý phản hồi từ server.');
                }
            },
            error: function(xhr, status, error) {
                alert('Lỗi kết nối: ' + error);
            },
            complete: function() {
                $btn.prop('disabled', false);
                $spinner.removeClass('is-active');
            }
        });
    });

    // Sync transactions
    $('#sync-transactions').on('click', function() {
        var $btn = $(this);
        $btn.prop('disabled', true).val('Đang đồng bộ...');
        
        $.post(ajaxUrl, {
            action: 'mbb_gw_sync_transactions',
            nonce: adminNonce
        }, function(response) {
            if (response.success) {
                alert('Đồng bộ thành công!');
                loadTransactions();
            } else {
                alert('Có lỗi xảy ra: ' + (response.msg || 'Unknown error'));
            }
        }).always(function() {
            $btn.prop('disabled', false).val('Đồng bộ giao dịch');
        });
    });

    // Reset data
    $('#reset-data').on('click', function() {
        if (confirm('Bạn có chắc chắn muốn xóa tất cả dữ liệu giao dịch?')) {
            $.post(ajaxUrl, {
                action: 'mbb_gw_reset_all_data',
                nonce: adminNonce
            }, function(response) {
                if (response.success) {
                    alert('Đã xóa tất cả dữ liệu!');
                    loadTransactions();
                } else {
                    alert('Có lỗi xảy ra!');
                }
            });
        }
    });

    // Test API Connection
    $('#test-api').on('click', function() {
        if (!debugEnabled) {
            alert('Debug mode is disabled');
            return;
        }
        var $btn = $(this);
        var $spinner = $('#login-status');
        var accessToken = $('#access_token').val().trim();
        
        if (!accessToken) {
            alert('Vui lòng nhập Access Token!');
            return;
        }
        
        $btn.prop('disabled', true).val('Đang kiểm tra...');
        $spinner.addClass('is-active');

        $.post(ajaxUrl, {
            action: 'mbb_gw_test_api',
            access_token: accessToken,
            nonce: adminNonce
        }, function(response) {
            if (response.success) {
                alert('🎉 Kết nối API thành công!\n\nĐã tìm thấy ' + (response.transaction_count || 0) + ' giao dịch trong 30 ngày qua.');
            } else {
                alert('❌ Kết nối API thất bại!\n\nLỗi: ' + (response.msg || 'Unknown error'));
            }
        }).fail(function(xhr, status, error) {
            alert('❌ Lỗi kết nối!\n\nChi tiết: ' + error);
        }).always(function() {
            $btn.prop('disabled', false).val('Test API Connection');
            $spinner.removeClass('is-active');
        });
    });

    // Save API Configuration
    $('#save-login').on('click', function() {
        var accessToken = $('#access_token').val().trim();
        
        if (!accessToken) {
            alert('Vui lòng nhập Access Token!');
            return;
        }
        
        var apiConfig = {
            access_token: accessToken
        };

        $.post(ajaxUrl, {
            action: 'mbb_gw_save_option',
            key: 'mbb_gw_login',
            data: apiConfig,
            nonce: adminNonce
        }, function(response) {
            try {
                if (typeof response === 'string') {
                    response = JSON.parse(response);
                }
                if (response.success) {
                    alert('✅ Đã lưu cấu hình API thành công!');
                } else {
                    alert('❌ Có lỗi xảy ra: ' + (response.msg || 'Unknown error'));
                }
            } catch (e) {
                alert('❌ Lỗi xử lý phản hồi từ server.');
            }
        }).fail(function(xhr, status, error) {
            alert('❌ Lỗi kết nối: ' + error);
        });
    });
});
</script>
