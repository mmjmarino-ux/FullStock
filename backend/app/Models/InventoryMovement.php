<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InventoryMovement extends Model
{
    protected $fillable = ['product_id', 'product_name', 'type', 'quantity', 'reference', 'note'];

    protected function casts(): array
    {
        return ['quantity' => 'integer'];
    }
}
