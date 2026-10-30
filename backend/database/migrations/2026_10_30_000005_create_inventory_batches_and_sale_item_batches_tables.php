<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_batches', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained()->cascadeOnDelete();
            $table->string('batch_code')->nullable()->unique();
            $table->unsignedInteger('received_quantity');
            $table->unsignedInteger('remaining_quantity');
            $table->date('expiration_date')->nullable();
            $table->string('note')->nullable();
            $table->timestamps();
            $table->index(['product_id', 'expiration_date', 'remaining_quantity']);
        });

        Schema::create('sale_item_batches', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sale_item_id')->constrained()->cascadeOnDelete();
            $table->foreignId('inventory_batch_id')->constrained('inventory_batches')->cascadeOnDelete();
            $table->unsignedInteger('quantity');
            $table->timestamps();
            $table->unique(['sale_item_id', 'inventory_batch_id']);
        });

        $now = now();
        foreach (DB::table('products')->where('stock', '>', 0)->orderBy('id')->get(['id', 'stock']) as $product) {
            DB::table('inventory_batches')->insertGetId([
                'product_id' => $product->id,
                'batch_code' => 'OPEN-' . $product->id,
                'received_quantity' => $product->stock,
                'remaining_quantity' => $product->stock,
                'expiration_date' => null,
                'note' => 'Opening stock carried forward during batch inventory setup',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('sale_item_batches');
        Schema::dropIfExists('inventory_batches');
    }
};
