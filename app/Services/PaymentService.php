<?php

namespace App\Services;

use App\Models\Payment;
use App\Models\Bill;

class PaymentService
{
    /**
     * บันทึกข้อมูลการชำระเงินและอัปเดตสถานะบิล
     *
     * @param int|string $billId
     * @param float $amount
     * @return void
     */
    public function confirmPayment($billId, $amount)
    {
        $bill = Bill::findOrFail($billId);

        Payment::create([
            'bill_id' => $bill->id,
            'amount' => $amount,
            'paid_at' => now()
        ]);

        $bill->status = 'paid';
        $bill->save();
    }

    /**
     * ตรวจสอบความถูกต้องของสลิปโอนเงิน (ถ้ามีการอัปโหลด)
     *
     * @param Bill $bill
     * @param mixed $slipData
     * @return bool
     */
    public function verifySlip(Bill $bill, $slipData)
    {
        // ลอจิกการเชื่อมต่อ 3rd Party API เพื่อตรวจสอบสลิป (เช่น SlipOK)
        return true;
    }
}
