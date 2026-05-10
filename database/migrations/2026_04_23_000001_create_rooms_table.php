<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rooms', function (Blueprint $table) {
            $table->id();
            $table->string('room_number')->unique();
            $table->decimal('monthly_rent', 8, 2);
            $table->string('tenant_name')->nullable();
            $table->string('tenant_phone')->nullable();
            $table->string('line_user_id')->nullable();
            $table->date('contract_start_date')->nullable();
            $table->decimal('deposit_amount', 10, 2)->default(0);
            $table->integer('initial_water_meter')->default(0);
            $table->integer('initial_electric_meter')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rooms');
    }
};
