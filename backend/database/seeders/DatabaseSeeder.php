<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        User::updateOrCreate(['email' => 'admin@fullstock.test'], [
            'name' => 'Admin',
            'password' => 'password',
            'role' => 'admin',
        ]);
        User::updateOrCreate(['email' => 'staff@fullstock.test'], [
            'name' => 'Demo Staff',
            'password' => 'password',
            'role' => 'staff',
        ]);
        $this->call(RiceCatalogSeeder::class);
    }
}
