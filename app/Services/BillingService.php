<?php

namespace App\Services;

use App\Models\Room;
use App\Models\Bill;
use App\Models\Setting;

class BillingService
{
    /**
     * คำนวณยอดบิล (ค่าเช่า, ค่าน้ำ, ค่าไฟ)
     * ปรับแต่งจากโค้ดที่คุณส่งมา เพื่อให้เข้ากับตัวแปรของ Model Room ในระบบ
     *
     * @param Room $room
     * @param int $waterUnit จำนวนหน่วยน้ำที่ใช้
     * @param int $electricUnit จำนวนหน่วยไฟที่ใช้
     * @return array
     */
    public function calculate(Room $room, $waterUnit, $electricUnit)
    {
        // ปรับ $room->price เป็น $room->monthly_rent ตามโครงสร้าง DB ของเรา
        $rent = $room->monthly_rent; 
        
        // ใช้ Setting::get() แทน helper setting() เพื่อดึงข้อมูลจากตาราง Settings
        $water = $waterUnit * (float) Setting::get('water_rate', 18);
        $electric = $electricUnit * (float) Setting::get('electric_rate', 8);

        $total = $rent + $water + $electric;

        return [
            'rent' => $rent,
            'water' => $water,
            'electric' => $electric,
            'total' => $total
        ];
    }

    /**
     * คำนวณและสร้างบิลสำหรับหลายๆ ห้องพร้อมกัน
     *
     * @param array $readings ข้อมูลมิเตอร์จาก request
     * @return void
     */
    public function generateBills(array $readings)
    {
        $currentMonth = now()->format('Y-m');

        foreach ($readings as $roomId => $reading) {
            $room = Room::find($roomId);
            if (!$room) continue;

            // 1. หาเลขมิเตอร์เดิม
            $lastBill = Bill::where('room_id', $roomId)->orderBy('id', 'desc')->first();
            $prevWater = $lastBill ? $lastBill->water_meter : ($room->initial_water_meter ?? 0);
            $prevElectric = $lastBill ? $lastBill->electric_meter : ($room->initial_electric_meter ?? 0);

            $currentWater = (int) $reading['water'];
            $currentElectric = (int) $reading['electric'];

            // 2. คำนวณหน่วยที่ใช้
            $waterUsage = max(0, $currentWater - $prevWater);
            $electricUsage = max(0, $currentElectric - $prevElectric);

            // 3. เรียกใช้งานฟังก์ชัน calculate() ตามที่คุณต้องการ
            $calculatedData = $this->calculate($room, $waterUsage, $electricUsage);

            // 4. สร้างหรืออัปเดตบิล
            Bill::updateOrCreate(
                ['room_id' => $roomId, 'billing_month' => $currentMonth],
                [
                    'water_meter' => $currentWater,
                    'electric_meter' => $currentElectric,
                    'total_amount' => $calculatedData['total'],
                    'status' => 'pending'
                ]
            );
        }
    }
}
