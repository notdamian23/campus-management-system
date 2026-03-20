#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "driver/i2c.h"
#include "driver/uart.h"
#include "esp_check.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define I2C_PORT I2C_NUM_0
#define I2C_SDA_PIN ((gpio_num_t)21)
#define I2C_SCL_PIN ((gpio_num_t)22)
#define I2C_FREQ_HZ 50000

#define LCD_BACKLIGHT 0x08
#define LCD_ENABLE 0x04
#define LCD_RS 0x01

#define LCD_COLS 16
#define LCD_ROWS 2

#define FP_UART_PORT UART_NUM_2
#define FP_UART_BAUD_RATE 57600
#define FP_UART_TX_PIN ((gpio_num_t)17)
#define FP_UART_RX_PIN ((gpio_num_t)16)
#define FP_UART_BUFFER_SIZE 256

#define FP_START_CODE_H 0xEF
#define FP_START_CODE_L 0x01
#define FP_PACKET_COMMAND 0x01
#define FP_PACKET_ACK 0x07
#define FP_ADDRESS 0xFFFFFFFFUL

#define FP_CMD_GET_IMAGE 0x01
#define FP_CMD_VERIFY_PASSWORD 0x13

#define FP_ACK_OK 0x00
#define FP_ACK_NO_FINGER 0x02
#define FP_ACK_PASSWORD_ERROR 0x13

#define LCD_RETRY_DELAY_MS 1500
#define FP_POLL_INTERVAL_MS 300
#define FP_RESULT_HOLD_MS 1200
#define FP_COMMAND_TIMEOUT_MS 900

static const char *TAG = "fingerprint_test";
static bool s_i2c_driver_ready = false;

typedef enum {
    FP_STATUS_READY = 0,
    FP_STATUS_FINGER_DETECTED,
    FP_STATUS_NO_FINGER,
    FP_STATUS_PASSWORD_ERROR,
    FP_STATUS_TIMEOUT,
    FP_STATUS_BAD_RESPONSE,
    FP_STATUS_LCD_NOT_FOUND,
} fp_status_t;

typedef struct {
    uint8_t ack_code;
    bool packet_valid;
} fp_response_t;

static uint8_t s_lcd_addr = 0;
static fp_status_t s_last_status = FP_STATUS_READY;

static esp_err_t lcd_write_raw(uint8_t value) {
    return i2c_master_write_to_device(I2C_PORT, s_lcd_addr, &value, 1, pdMS_TO_TICKS(100));
}

static esp_err_t lcd_pulse(uint8_t value) {
    esp_err_t err = lcd_write_raw(value | LCD_ENABLE);
    if (err != ESP_OK) {
        return err;
    }

    esp_rom_delay_us(1);
    err = lcd_write_raw(value & (uint8_t)~LCD_ENABLE);
    esp_rom_delay_us(50);
    return err;
}

static esp_err_t lcd_send_nibble(uint8_t nibble, bool rs) {
    uint8_t value = (uint8_t)((nibble & 0x0F) << 4) | LCD_BACKLIGHT;
    if (rs) {
        value |= LCD_RS;
    }

    esp_err_t err = lcd_write_raw(value);
    if (err != ESP_OK) {
        return err;
    }

    return lcd_pulse(value);
}

static esp_err_t lcd_send_byte(uint8_t value, bool rs) {
    esp_err_t err = lcd_send_nibble((uint8_t)(value >> 4), rs);
    if (err != ESP_OK) {
        return err;
    }

    return lcd_send_nibble((uint8_t)(value & 0x0F), rs);
}

static esp_err_t lcd_command(uint8_t command) {
    esp_err_t err = lcd_send_byte(command, false);
    if (err == ESP_OK) {
        if (command == 0x01 || command == 0x02) {
            vTaskDelay(pdMS_TO_TICKS(3));
        } else {
            esp_rom_delay_us(50);
        }
    }
    return err;
}

static esp_err_t lcd_data(uint8_t value) {
    return lcd_send_byte(value, true);
}

static esp_err_t lcd_print_line(uint8_t row, const char *text) {
    static const uint8_t row_offsets[LCD_ROWS] = {0x00, 0x40};
    char buffer[LCD_COLS + 1];
    size_t text_len = strlen(text);
    size_t copy_len = text_len > LCD_COLS ? LCD_COLS : text_len;

    memset(buffer, ' ', sizeof(buffer) - 1);
    buffer[LCD_COLS] = '\0';
    memcpy(buffer, text, copy_len);

    esp_err_t err = lcd_command((uint8_t)(0x80 | row_offsets[row]));
    if (err != ESP_OK) {
        return err;
    }

    for (size_t i = 0; i < LCD_COLS; ++i) {
        err = lcd_data((uint8_t)buffer[i]);
        if (err != ESP_OK) {
            return err;
        }
    }

    return ESP_OK;
}

static esp_err_t lcd_show(const char *line1, const char *line2) {
    esp_err_t err = lcd_print_line(0, line1);
    if (err != ESP_OK) {
        return err;
    }

    return lcd_print_line(1, line2);
}

static bool lcd_detect_address(uint8_t address) {
    uint8_t probe = LCD_BACKLIGHT;
    return i2c_master_write_to_device(I2C_PORT, address, &probe, 1, pdMS_TO_TICKS(100)) == ESP_OK;
}

static esp_err_t lcd_find_address(void) {
    const uint8_t candidates[] = {0x27, 0x3F, 0x26, 0x25, 0x24, 0x23, 0x22, 0x21, 0x20};

    for (size_t i = 0; i < (sizeof(candidates) / sizeof(candidates[0])); ++i) {
        if (lcd_detect_address(candidates[i])) {
            s_lcd_addr = candidates[i];
            ESP_LOGI(TAG, "LCD backpack detected at 0x%02X", s_lcd_addr);
            return ESP_OK;
        }
    }

    return ESP_ERR_NOT_FOUND;
}

static esp_err_t lcd_init(void) {
    i2c_config_t config = {
        .mode = I2C_MODE_MASTER,
        .sda_io_num = I2C_SDA_PIN,
        .scl_io_num = I2C_SCL_PIN,
        .sda_pullup_en = GPIO_PULLUP_ENABLE,
        .scl_pullup_en = GPIO_PULLUP_ENABLE,
        .master.clk_speed = I2C_FREQ_HZ,
    };

    ESP_RETURN_ON_ERROR(i2c_param_config(I2C_PORT, &config), TAG, "I2C config failed");
    if (!s_i2c_driver_ready) {
        ESP_RETURN_ON_ERROR(i2c_driver_install(I2C_PORT, config.mode, 0, 0, 0), TAG, "I2C install failed");
        s_i2c_driver_ready = true;
    }
    ESP_RETURN_ON_ERROR(lcd_find_address(), TAG, "LCD not found");

    ESP_RETURN_ON_ERROR(lcd_write_raw(LCD_BACKLIGHT), TAG, "LCD idle write failed");
    vTaskDelay(pdMS_TO_TICKS(60));

    ESP_RETURN_ON_ERROR(lcd_send_nibble(0x03, false), TAG, "LCD init step 1 failed");
    vTaskDelay(pdMS_TO_TICKS(5));
    ESP_RETURN_ON_ERROR(lcd_send_nibble(0x03, false), TAG, "LCD init step 2 failed");
    vTaskDelay(pdMS_TO_TICKS(5));
    ESP_RETURN_ON_ERROR(lcd_send_nibble(0x03, false), TAG, "LCD init step 3 failed");
    esp_rom_delay_us(200);
    ESP_RETURN_ON_ERROR(lcd_send_nibble(0x02, false), TAG, "LCD 4-bit mode failed");
    ESP_RETURN_ON_ERROR(lcd_command(0x28), TAG, "LCD function set failed");
    ESP_RETURN_ON_ERROR(lcd_command(0x08), TAG, "LCD display off failed");
    ESP_RETURN_ON_ERROR(lcd_command(0x01), TAG, "LCD clear failed");
    ESP_RETURN_ON_ERROR(lcd_command(0x06), TAG, "LCD entry mode failed");
    ESP_RETURN_ON_ERROR(lcd_command(0x0C), TAG, "LCD display control failed");

    return ESP_OK;
}

static esp_err_t fp_uart_init(void) {
    const uart_config_t config = {
        .baud_rate = FP_UART_BAUD_RATE,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };

    ESP_RETURN_ON_ERROR(uart_driver_install(FP_UART_PORT, FP_UART_BUFFER_SIZE, FP_UART_BUFFER_SIZE, 0, NULL, 0), TAG, "UART install failed");
    ESP_RETURN_ON_ERROR(uart_param_config(FP_UART_PORT, &config), TAG, "UART config failed");
    ESP_RETURN_ON_ERROR(uart_set_pin(FP_UART_PORT, FP_UART_TX_PIN, FP_UART_RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE), TAG, "UART pin config failed");
    ESP_RETURN_ON_ERROR(uart_flush(FP_UART_PORT), TAG, "UART flush failed");

    return ESP_OK;
}

static size_t fp_build_command(uint8_t instruction, const uint8_t *payload, size_t payload_len, uint8_t *packet, size_t packet_size) {
    size_t index = 0;
    uint16_t packet_length = (uint16_t)(payload_len + 3U);
    uint16_t checksum = (uint16_t)(FP_PACKET_COMMAND + (packet_length >> 8) + (packet_length & 0xFF) + instruction);

    if (packet_size < (size_t)(12 + payload_len)) {
        return 0;
    }

    packet[index++] = FP_START_CODE_H;
    packet[index++] = FP_START_CODE_L;
    packet[index++] = 0xFF;
    packet[index++] = 0xFF;
    packet[index++] = 0xFF;
    packet[index++] = 0xFF;
    packet[index++] = FP_PACKET_COMMAND;
    packet[index++] = (uint8_t)(packet_length >> 8);
    packet[index++] = (uint8_t)(packet_length & 0xFF);
    packet[index++] = instruction;

    for (size_t i = 0; i < payload_len; ++i) {
        packet[index++] = payload[i];
        checksum = (uint16_t)(checksum + payload[i]);
    }

    packet[index++] = (uint8_t)(checksum >> 8);
    packet[index++] = (uint8_t)(checksum & 0xFF);

    return index;
}

static esp_err_t fp_send_command(uint8_t instruction, const uint8_t *payload, size_t payload_len) {
    uint8_t packet[32];
    size_t packet_len = fp_build_command(instruction, payload, payload_len, packet, sizeof(packet));

    if (packet_len == 0) {
        return ESP_ERR_INVALID_SIZE;
    }

    ESP_RETURN_ON_ERROR(uart_flush_input(FP_UART_PORT), TAG, "UART RX flush failed");

    int written = uart_write_bytes(FP_UART_PORT, packet, packet_len);
    if (written != (int)packet_len) {
        return ESP_FAIL;
    }

    return uart_wait_tx_done(FP_UART_PORT, pdMS_TO_TICKS(200));
}

static esp_err_t fp_read_exact(uint8_t *buffer, size_t length, TickType_t timeout_ticks) {
    size_t received = 0;
    TickType_t start = xTaskGetTickCount();

    while (received < length) {
        TickType_t elapsed = xTaskGetTickCount() - start;
        TickType_t remaining = elapsed >= timeout_ticks ? 0 : timeout_ticks - elapsed;
        int bytes_read = uart_read_bytes(FP_UART_PORT, buffer + received, length - received, remaining);

        if (bytes_read <= 0) {
            return ESP_ERR_TIMEOUT;
        }

        received += (size_t)bytes_read;
    }

    return ESP_OK;
}

static esp_err_t fp_read_response(fp_response_t *response) {
    uint8_t header[9];
    uint8_t trailer[32];
    uint16_t packet_length = 0;
    uint16_t expected_checksum = 0;
    uint16_t received_checksum = 0;

    memset(response, 0, sizeof(*response));

    ESP_RETURN_ON_ERROR(fp_read_exact(header, sizeof(header), pdMS_TO_TICKS(FP_COMMAND_TIMEOUT_MS)), TAG, "No response header");

    packet_length = (uint16_t)((header[7] << 8) | header[8]);
    if (header[0] != FP_START_CODE_H || header[1] != FP_START_CODE_L || header[6] != FP_PACKET_ACK) {
        return ESP_ERR_INVALID_RESPONSE;
    }

    if (packet_length < 3 || packet_length > sizeof(trailer)) {
        return ESP_ERR_INVALID_SIZE;
    }

    ESP_RETURN_ON_ERROR(fp_read_exact(trailer, packet_length, pdMS_TO_TICKS(FP_COMMAND_TIMEOUT_MS)), TAG, "Incomplete response");

    expected_checksum = (uint16_t)(header[6] + header[7] + header[8]);
    for (uint16_t i = 0; i < packet_length - 2; ++i) {
        expected_checksum = (uint16_t)(expected_checksum + trailer[i]);
    }

    received_checksum = (uint16_t)((trailer[packet_length - 2] << 8) | trailer[packet_length - 1]);
    if (expected_checksum != received_checksum) {
        return ESP_ERR_INVALID_CRC;
    }

    response->ack_code = trailer[0];
    response->packet_valid = true;
    return ESP_OK;
}

static fp_status_t fp_verify_password(void) {
    static const uint8_t password[4] = {0x00, 0x00, 0x00, 0x00};
    fp_response_t response;
    esp_err_t err = fp_send_command(FP_CMD_VERIFY_PASSWORD, password, sizeof(password));

    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to send verify-password command: %s", esp_err_to_name(err));
        return FP_STATUS_TIMEOUT;
    }

    err = fp_read_response(&response);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Verify-password read failed: %s", esp_err_to_name(err));
        return err == ESP_ERR_TIMEOUT ? FP_STATUS_TIMEOUT : FP_STATUS_BAD_RESPONSE;
    }

    ESP_LOGI(TAG, "AS608 verify-password ACK: 0x%02X", response.ack_code);

    if (response.ack_code == FP_ACK_OK) {
        return FP_STATUS_READY;
    }

    if (response.ack_code == FP_ACK_PASSWORD_ERROR) {
        return FP_STATUS_PASSWORD_ERROR;
    }

    return FP_STATUS_BAD_RESPONSE;
}

static fp_status_t fp_get_image(void) {
    fp_response_t response;
    esp_err_t err = fp_send_command(FP_CMD_GET_IMAGE, NULL, 0);

    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to send get-image command: %s", esp_err_to_name(err));
        return FP_STATUS_TIMEOUT;
    }

    err = fp_read_response(&response);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Get-image read failed: %s", esp_err_to_name(err));
        return err == ESP_ERR_TIMEOUT ? FP_STATUS_TIMEOUT : FP_STATUS_BAD_RESPONSE;
    }

    if (response.ack_code == FP_ACK_OK) {
        return FP_STATUS_FINGER_DETECTED;
    }

    if (response.ack_code == FP_ACK_NO_FINGER) {
        return FP_STATUS_NO_FINGER;
    }

    ESP_LOGW(TAG, "Unexpected get-image ACK: 0x%02X", response.ack_code);
    return FP_STATUS_BAD_RESPONSE;
}

static void show_fatal_lcd_message(const char *line1, const char *line2) {
    if (s_lcd_addr != 0) {
        lcd_show(line1, line2);
    }
}

static void show_runtime_status(fp_status_t status) {
    if (status == s_last_status) {
        return;
    }

    switch (status) {
        case FP_STATUS_READY:
            lcd_show("AS608 ONLINE", "Place finger...");
            ESP_LOGI(TAG, "Fingerprint scanner online");
            break;
        case FP_STATUS_FINGER_DETECTED:
            lcd_show("FINGER DETECTED", "Scanner OK");
            ESP_LOGI(TAG, "Finger detected");
            break;
        case FP_STATUS_NO_FINGER:
            lcd_show("AS608 ONLINE", "Place finger...");
            break;
        case FP_STATUS_PASSWORD_ERROR:
            lcd_show("FP UART OK", "Password changed");
            ESP_LOGW(TAG, "Sensor responded, but password is not the default 00000000");
            break;
        case FP_STATUS_TIMEOUT:
            lcd_show("FP NOT FOUND", "Check RX TX PWR");
            ESP_LOGE(TAG, "No reply from fingerprint scanner");
            break;
        case FP_STATUS_BAD_RESPONSE:
            lcd_show("FP RESPONSE ERR", "Check baud/wires");
            ESP_LOGE(TAG, "Fingerprint scanner response was invalid");
            break;
        case FP_STATUS_LCD_NOT_FOUND:
            ESP_LOGE(TAG, "LCD backpack not detected at common addresses");
            break;
    }

    s_last_status = status;
}

void app_main(void) {
    esp_err_t err = lcd_init();
    if (err != ESP_OK) {
        s_last_status = FP_STATUS_LCD_NOT_FOUND;
        ESP_LOGE(TAG, "LCD init failed: %s", esp_err_to_name(err));
        while (true) {
            vTaskDelay(pdMS_TO_TICKS(LCD_RETRY_DELAY_MS));
            err = lcd_init();
            if (err == ESP_OK) {
                break;
            }
            ESP_LOGE(TAG, "Retrying LCD init: %s", esp_err_to_name(err));
        }
    }

    lcd_show("Campus FP Test", "Init scanner...");

    err = fp_uart_init();
    if (err != ESP_OK) {
        show_fatal_lcd_message("UART INIT FAIL", "Check GPIO16/17");
        ESP_LOGE(TAG, "Fingerprint UART init failed: %s", esp_err_to_name(err));
        return;
    }

    vTaskDelay(pdMS_TO_TICKS(300));

    fp_status_t status = fp_verify_password();
    show_runtime_status(status);

    if (status == FP_STATUS_PASSWORD_ERROR || status == FP_STATUS_TIMEOUT || status == FP_STATUS_BAD_RESPONSE) {
        while (true) {
            vTaskDelay(pdMS_TO_TICKS(2000));
        }
    }

    while (true) {
        status = fp_get_image();
        show_runtime_status(status);

        if (status == FP_STATUS_FINGER_DETECTED) {
            vTaskDelay(pdMS_TO_TICKS(FP_RESULT_HOLD_MS));
            show_runtime_status(FP_STATUS_READY);
        } else {
            vTaskDelay(pdMS_TO_TICKS(FP_POLL_INTERVAL_MS));
        }
    }
}
