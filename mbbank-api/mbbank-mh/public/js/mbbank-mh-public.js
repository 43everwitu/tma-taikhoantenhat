(function ($) {
  "use strict";

  /**
   * All of the code for your public-facing JavaScript source
   * should reside in this file.
   */

  $(document).ready(function () {
    // Copy functionality
    $(".copy-btn").on("click", function (e) {
      e.preventDefault();
      var textToCopy = $(this).data("c");

      if (navigator.clipboard) {
        navigator.clipboard.writeText(textToCopy).then(function () {
          showCopySuccess();
        });
      } else {
        // Fallback for older browsers
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
      if (typeof Swal !== "undefined") {
        Swal.fire({
          icon: "success",
          title: "Đã sao chép!",
          text: "Nội dung đã được sao chép vào clipboard",
          timer: 1500,
          showConfirmButton: false,
        });
      } else {
        alert("Đã sao chép vào clipboard!");
      }
    }

    // Download QR code functionality - removed since it's now handled by inline onclick function

    var mbbPaymentAuthFailed = false;

    function checkPaymentStatus() {
      if (mbbPaymentAuthFailed) {
        return;
      }
      var orderId = $("#mbb-gateway-order_id").val();
      var orderKey = $("#mbb-gateway-order_key").val();
      var nonce = $("#mbb-gateway-nonce").val();
      var settings = $("#mbb-gateway-settings").data("settings");

      if (!orderId || !settings) {
        return;
      }

      $.ajax({
        url: settings.ajax_url,
        type: "GET",
        data: {
          action: "mbb_gw_waiting_payment",
          order_id: orderId,
          order_key: orderKey || "",
          nonce: nonce || "",
        },
        success: function (response) {
          if (response && response.success) {
            if (typeof Swal !== "undefined") {
              Swal.fire({
                icon: "success",
                title: "Thanh toán thành công!",
                text: response.msg || "Cảm ơn bạn đã thanh toán",
                confirmButtonText: "OK",
              }).then(function () {
                if (settings.reload_after_completed) {
                  location.reload();
                } else if (settings.url_redirect) {
                  window.location.href = settings.url_redirect;
                } else {
                  location.reload();
                }
              });
            } else {
              alert(response.msg || "Thanh toán thành công!");
              location.reload();
            }
          } else {
            var errText =
              response && response.msg ? String(response.msg).toLowerCase() : "";
            if (errText.indexOf("invalid security token") !== -1) {
              mbbPaymentAuthFailed = true;
              if (typeof Swal !== "undefined") {
                Swal.fire({
                  icon: "error",
                  title: "Không thể kiểm tra thanh toán",
                  text: "Phiên đã hết hạn hoặc không hợp lệ. Vui lòng tải lại trang (F5).",
                });
              } else {
                alert(
                  "Phiên thanh toán không hợp lệ. Vui lòng tải lại trang (F5)."
                );
              }
              return;
            }
            setTimeout(checkPaymentStatus, 5000);
          }
        },
        error: function (xhr, status, error) {
          setTimeout(checkPaymentStatus, 7000);
        },
      });
    }

    if (
      $("#mbb-gateway-order_id").length > 0 &&
      $(".acb-gateway-result").length === 0
    ) {
      setTimeout(checkPaymentStatus, 3000);
    }
  });
})(jQuery);
