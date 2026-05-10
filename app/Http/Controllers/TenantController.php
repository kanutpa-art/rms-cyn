<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\Room;
use App\Models\Bill;

class TenantController extends Controller
{
    /**
     * หน้าแดชบอร์ดฝั่งผู้เช่า (Mobile view)
     */
    public function dashboard(Request $request)
    {
        // 1. รับค่า line_user_id จาก URL หรือ Session (จำลองการรับค่าจาก LINE LIFF)
        $lineUserId = $request->get('line_id', 'mock_line_id');
        
        // 2. ค้นหาห้องที่ผูกกับ LINE ID นี้
        $room = Room::where('line_user_id', $lineUserId)->first();

        if (!$room) {
            // ถ้าไม่พบ แสดงว่ายังไม่ได้ลงทะเบียนผูกห้อง
            return "ไม่พบข้อมูลห้องพัก หรือคุณยังไม่ได้ผูก LINE กับระบบ กรุณาติดต่อแอดมิน";
        }

        // 3. ดึงบิลล่าสุดของห้องนี้มาแสดง
        $currentBill = Bill::where('room_id', $room->id)->orderBy('id', 'desc')->first();

        // 4. แปลงข้อมูลส่งให้ Blade ให้ตรงกับรูปแบบที่ Blade ต้องการ
        return view('tenant.dashboard', [
            'tenant' => (object) [
                'first_name' => $room->tenant_name,
                'activeContract' => (object) [
                    'room' => (object) ['room_number' => $room->room_number]
                ]
            ],
            'currentBill' => $currentBill
        ]);
    }
}
