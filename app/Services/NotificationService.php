<?php

namespace App\Services;

use App\Models\Bill;
use App\Models\Room;
use Illuminate\Support\Facades\Log;

class NotificationService
{
    /**
     * ส่งข้อความผ่าน LINE API
     *
     * @param string $userId
     * @param string $message
     * @return void
     */
    public function sendLine($userId, $message)
    {
        // call LINE API
        // เตรียมไว้สำหรับเขียน HTTP Client ยิงไปหา LINE Messaging API ในอนาคต
        Log::info("LINE API (Simulated) to User {$userId}: {$message}");
    }

    /**
     * ส่งการแจ้งเตือนบิลค่าเช่าไปหาผู้เช่า
     *
     * @param Room $room
     * @param Bill $bill
     * @return void
     */
    public function sendBillNotification(Room $room, Bill $bill)
    {
        if (!$room->line_user_id) {
            return;
        }

        $message = "ใบแจ้งหนี้เดือน {$bill->billing_month}\n";
        $message .= "ห้อง: {$room->room_number}\n";
        $message .= "ยอดชำระ: " . number_format($bill->total_amount, 2) . " บาท";

        // เรียกใช้งาน sendLine
        $this->sendLine($room->line_user_id, $message);
    }

    /**
     * ส่งใบเสร็จรับเงินเมื่อชำระแล้ว
     *
     * @param Room $room
     * @param Bill $bill
     * @return void
     */
    public function sendPaymentReceipt(Room $room, Bill $bill)
    {
        if (!$room->line_user_id) {
            return;
        }

        $message = "ชำระเงินเรียบร้อยแล้ว\n";
        $message .= "ห้อง: {$room->room_number}\n";
        $message .= "ขอบคุณที่ชำระค่าเช่าเดือน {$bill->billing_month}";

        // เรียกใช้งาน sendLine
        $this->sendLine($room->line_user_id, $message);
    }
}
