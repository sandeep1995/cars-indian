-- D1 Database Schema for Used Cars

CREATE TABLE IF NOT EXISTS used_cars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  used_car_id INTEGER UNIQUE NOT NULL,
  used_car_sku_id TEXT UNIQUE NOT NULL,
  price INTEGER NOT NULL,
  formatted_price TEXT NOT NULL,
  msp INTEGER,
  myear INTEGER,
  model TEXT NOT NULL,
  variant_name TEXT,
  oem TEXT NOT NULL,
  km TEXT,
  fuel_type TEXT,
  transmission_type TEXT,
  city TEXT NOT NULL,
  city_id INTEGER,
  locality TEXT,
  location TEXT,
  body_type TEXT,
  owner INTEGER,
  owner_slug TEXT,
  dealer_id INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT 1,
  inventory_status INTEGER DEFAULT 1,
  inventory_type_label TEXT,
  car_type TEXT,
  corporate_id INTEGER,
  store_id TEXT,
  utype TEXT,
  vlink TEXT,
  from_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_used_car_id ON used_cars(used_car_id);
CREATE INDEX IF NOT EXISTS idx_used_car_sku_id ON used_cars(used_car_sku_id);
CREATE INDEX IF NOT EXISTS idx_city ON used_cars(city);
CREATE INDEX IF NOT EXISTS idx_city_id ON used_cars(city_id);
CREATE INDEX IF NOT EXISTS idx_oem ON used_cars(oem);
CREATE INDEX IF NOT EXISTS idx_model ON used_cars(model);
CREATE INDEX IF NOT EXISTS idx_price ON used_cars(price);
CREATE INDEX IF NOT EXISTS idx_myear ON used_cars(myear);
CREATE INDEX IF NOT EXISTS idx_active ON used_cars(active);

CREATE TABLE IF NOT EXISTS car_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  used_car_id INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  image_order INTEGER NOT NULL DEFAULT 0,
  is_primary BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (used_car_id) REFERENCES used_cars(used_car_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_car_images_car_id ON car_images(used_car_id);
CREATE INDEX IF NOT EXISTS idx_car_images_order ON car_images(used_car_id, image_order);
CREATE INDEX IF NOT EXISTS idx_car_images_primary ON car_images(used_car_id, is_primary);

