<?php

namespace App\Http\Controllers;

use App\Models\Room;
use Illuminate\Http\Request;

class RoomController extends Controller
{
    /**
     * แสดงรายชื่อห้องพักทั้งหมด
     */
    public function index()
    {
        $rooms = Room::orderBy('room_number')->get();
        return view('admin.rooms.index', compact('rooms'));
    }

    /**
     * บันทึกข้อมูลห้องพักใหม่
     */
    public function store(Request $request)
    {
        $request->validate([
            'room_number' => 'required|unique:rooms',
            'monthly_rent' => 'required|numeric',
            'initial_water_meter' => 'nullable|numeric',
            'initial_electric_meter' => 'nullable|numeric',
            'tenant_phone' => 'nullable|string',
            'contract_start_date' => 'nullable|date',
            'deposit_amount' => 'nullable|numeric',
        ]);

        Room::create($request->all());

        return redirect()->route('admin.rooms.index')->with('success', 'เพิ่มห้องพักเรียบร้อยแล้ว');
    }

    /**
     * อัปเดตข้อมูลห้องพัก (เช่น เมื่อมีผู้เช่าใหม่ย้ายเข้า)
     */
    public function update(Request $request, Room $room)
    {
        $request->validate([
            'room_number' => 'required|unique:rooms,room_number,' . $room->id,
            'monthly_rent' => 'required|numeric',
            'initial_water_meter' => 'nullable|numeric',
            'initial_electric_meter' => 'nullable|numeric',
            'tenant_phone' => 'nullable|string',
            'contract_start_date' => 'nullable|date',
            'deposit_amount' => 'nullable|numeric',
        ]);

        $room->update($request->all());

        return redirect()->route('admin.rooms.index')->with('success', 'อัปเดตข้อมูลห้องพักเรียบร้อยแล้ว');
    }

    /**
     * ย้ายออก (Checkout) - เคลียร์ข้อมูลผู้เช่า
     */
    public function checkout(Room $room)
    {
        $room->update([
            'tenant_name' => null,
            'line_user_id' => null
        ]);

        return redirect()->route('admin.rooms.index')->with('success', 'แจ้งย้ายออกห้อง ' . $room->room_number . ' เรียบร้อยแล้ว');
    }

    /**
     * ลบห้องพัก
     */
    public function destroy(Room $room)
    {
        $room->delete();
        return redirect()->route('admin.rooms.index')->with('success', 'ลบห้องพักเรียบร้อยแล้ว');
    }
}
