<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\Room;
use App\Models\Bill;
use App\Models\Setting;
use App\Services\BillingService;
use App\Services\NotificationService;
use App\Services\PaymentService;

class AdminController extends Controller
{
    /**
     * หน้า Dashboard แอดมิน: สรุปรายได้และบิลที่รอตรวจสอบ
     */
    public function dashboard()
    {
        $currentMonth = now()->format('Y-m');
        
        // 1. คำนวณรายรับ (เฉพาะบิลที่จ่ายแล้วของเดือนนี้)
        $revenue = Bill::where('billing_month', $currentMonth)
                       ->where('status', 'paid')
                       ->sum('total_amount');
        
        // 2. ยอดค้างชำระทั้งหมด (บิลที่ยังเป็น pending ทุกเดือน)
        $overdueAmount = Bill::where('status', 'pending')->sum('total_amount');
        $overdueCount = Bill::where('status', 'pending')->count();
        
        // 3. สถานะห้องพัก
        $totalRooms = Room::count();
        $occupiedRooms = Room::whereNotNull('tenant_name')->count();
        $vacantRooms = $totalRooms - $occupiedRooms;

        // 4. ดึงบิลที่รอการตรวจสอบ (สมมติว่าเป็นบิลที่รอกดชำระ)
        $pendingBills = Bill::with('room')
                            ->where('status', 'pending')
                            ->orderBy('created_at', 'desc')
                            ->get();
        
        // 5. จำนวนแจ้งซ่อมที่ค้างอยู่
        $pendingMaintenanceCount = \App\Models\MaintenanceRequest::where('status', '!=', 'completed')->count();

        return view('admin.dashboard', compact(
            'revenue', 'overdueAmount', 'overdueCount', 
            'totalRooms', 'occupiedRooms', 'vacantRooms', 
            'pendingBills', 'pendingMaintenanceCount'
        ));
    }

    /**
     * หน้าแสดงฟอร์มกรอกมิเตอร์ประจำเดือน
     */
    public function billing()
    {
        // ดึงเฉพาะห้องที่มีคนเช่าอยู่
        $rooms = Room::whereNotNull('tenant_name')->get();
        return view('admin.billing', compact('rooms'));
    }

    /**
     * ลอจิกการคำนวณบิล (Rent + Water + Electric)
     */
    public function storeBills(Request $request, NotificationService $notificationService)
    {
        $currentMonth = now()->format('Y-m');
        $billingService = new BillingService();

        // วนลูปตามที่ส่งมาจากฟอร์ม
        if ($request->has('readings')) {
            foreach ($request->readings as $roomId => $reading) {
                $room = Room::find($roomId);
                if (!$room) continue;

                // 1. หาเลขมิเตอร์เดือนก่อนหน้าเพื่อมาหักลบ
                $lastBill = Bill::where('room_id', $roomId)->orderBy('id', 'desc')->first();
                $prevWater = $lastBill ? $lastBill->water_meter : ($room->initial_water_meter ?? 0);
                $prevElectric = $lastBill ? $lastBill->electric_meter : ($room->initial_electric_meter ?? 0);

                $currentWater = (int) $reading['water'];
                $currentElectric = (int) $reading['electric'];

                $waterUsage = max(0, $currentWater - $prevWater);
                $electricUsage = max(0, $currentElectric - $prevElectric);

                // 2. BillingService คำนวณ
                $result = $billingService->calculate($room, $waterUsage, $electricUsage);

                // 3. บันทึก Bill
                $bill = Bill::updateOrCreate(
                    ['room_id' => $roomId, 'billing_month' => $currentMonth],
                    [
                        'water_meter' => $currentWater,
                        'electric_meter' => $currentElectric,
                        'total_amount' => $result['total'],
                        'status' => 'pending'
                    ]
                );

                // 4. NotificationService ส่ง LINE
                $notificationService->sendBillNotification($room, $bill);
            }
        }

        return redirect()->route('admin.dashboard')->with('success', 'สร้างบิลประจำเดือนและส่งแจ้งเตือน LINE สำเร็จแล้ว!');
    }

    /**
     * เปลี่ยนสถานะบิลเป็น "จ่ายแล้ว" (เมื่อแอดมินเห็นสลิปใน LINE)
     */
    public function markAsPaid($id, PaymentService $paymentService, NotificationService $notificationService)
    {
        $bill = Bill::findOrFail($id);
        
        // 7. PaymentService confirm (สมมติว่าแอดมินกดยืนยัน ถือว่าจ่ายเต็มจำนวน)
        $paymentService->confirmPayment($bill->id, $bill->total_amount);

        // (Optional) ส่งใบเสร็จให้ผู้เช่า
        $notificationService->sendPaymentReceipt($bill->room, $bill);

        return redirect()->back()->with('success', 'บันทึกสถานะบิลว่า ชำระแล้ว พร้อมส่งใบเสร็จ!');
    }
}
