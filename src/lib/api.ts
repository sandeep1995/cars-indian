import { slugify } from './slug';

// Hardcoded token as requested
const TOKEN = 'qbxm2tn9';
const API_URL = 'https://api.indianluxurycars.com/rest/used_cars';
const QUERY_URL = 'https://api.indianluxurycars.com/query';

export type UsedCar = {
  id: number;
  used_car_id: number;
  used_car_sku_id: string;
  price: number;
  formatted_price: string;
  msp: number;
  myear: number;
  model: string;
  variant_name: string;
  oem: string;
  km: string;
  fuel_type: string;
  transmission_type: string;
  city: string;
  city_id: number;
  locality: string;
  location: string;
  body_type: string;
  owner: number;
  owner_slug: string;
  dealer_id: number;
  active: number;
  inventory_status: number;
  inventory_type_label: string;
  car_type: string;
  corporate_id: number;
  store_id: string;
  utype: string;
  vlink: string;
  from_url: string;
  created_at: string;
  updated_at: string;
  // Enhanced fields
  image_url?: string;
  images?: string[];
};

export async function getAllUsedCars(): Promise<UsedCar[]> {
  // Use query API to get all cars and their images efficiently
  // We use a LEFT JOIN to get all images, ordered by car then image priority
  // Note: Fetching ALL cars + ALL images might be heavy.
  // Ideally for sitemap/static paths, we just need basic info.
  // But to remove JSON cache from [slug].astro static generation, we need images there.
  
  const sql = `
    SELECT c.*, i.image_url, i.is_primary 
    FROM used_cars c 
    LEFT JOIN car_images i ON c.used_car_id = i.used_car_id 
    ORDER BY c.created_at DESC, i.is_primary DESC
  `;

  try {
    const response = await fetch(QUERY_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: sql, params: [] })
    });

    if (!response.ok) {
        console.error(`Failed to fetch all cars: ${response.status}`);
        return [];
    }

    const data = await response.json();
    const rows = data.results || [];
    
    // Group rows by car
    const carsMap = new Map<number, UsedCar>();
    
    for (const row of rows) {
        if (!carsMap.has(row.id)) {
            carsMap.set(row.id, { ...row, images: [] });
            delete carsMap.get(row.id)!.image_url; // Clean up
            delete carsMap.get(row.id)!.is_primary; // Clean up
        }
        
        const car = carsMap.get(row.id)!;
        if (row.image_url) {
            // Avoid duplicates
            if (!car.images!.includes(row.image_url)) {
                car.images!.push(row.image_url);
            }
        }
    }

    return Array.from(carsMap.values());
  } catch (e) {
      console.error('Error fetching all cars:', e);
      return [];
  }
}

export type FetchCarsOptions = {
  limit?: number;
  offset?: number;
  sort_by?: string;
  order?: 'asc' | 'desc';
  city?: string;
  oem?: string;
  model?: string;
  body_type?: string;
  fuel_type?: string;
  // We can add more specific filters here if needed
  [key: string]: string | number | undefined;
};

export type FetchCarsResult = {
  success: boolean;
  results: UsedCar[];
  meta: {
    total?: number;
    [key: string]: any;
  };
};

export async function getCars(options: FetchCarsOptions = {}): Promise<FetchCarsResult> {
  // Build SQL Query dynamically
  let sql = `
    SELECT c.*, i.image_url 
    FROM used_cars c 
    LEFT JOIN car_images i ON c.used_car_id = i.used_car_id AND i.is_primary = 1
  `;
  
  const whereClauses: string[] = [];
  const params: any[] = [];

  if (options.city) {
    // Some pages may pass "Delhi" while data may contain "New Delhi" etc.
    // Use a case-insensitive exact-or-contains match to keep filters forgiving.
    whereClauses.push('(LOWER(c.city) = LOWER(?) OR LOWER(c.city) LIKE \'%\' || LOWER(?) || \'%\')');
    params.push(options.city, options.city);
  }
  if (options.oem) {
    whereClauses.push('c.oem = ?');
    params.push(options.oem);
  }
  if (options.model) {
      whereClauses.push('c.model = ?');
      params.push(options.model);
  }
  if (options.body_type) {
      whereClauses.push('c.body_type = ?');
      params.push(options.body_type);
  }
  if (options.fuel_type) {
      whereClauses.push('c.fuel_type = ?');
      params.push(options.fuel_type);
  }

  if (whereClauses.length > 0) {
    sql += ' WHERE ' + whereClauses.join(' AND ');
  }

  // Sorting
  const sortCol = options.sort_by === 'price' ? 'c.price' : 'c.created_at';
  const sortOrder = options.order === 'asc' ? 'ASC' : 'DESC';
  sql += ` ORDER BY ${sortCol} ${sortOrder}`;

  // Pagination
  const limit = options.limit || 24;
  const offset = options.offset || 0;
  sql += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  try {
    const response = await fetch(QUERY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: sql, params })
    });

    if (!response.ok) {
      console.error(`Failed to fetch cars: ${response.status} ${response.statusText}`);
      return { success: false, results: [], meta: {} };
    }

    const data = await response.json();
    return {
        success: data.success,
        results: data.results || [],
        meta: data.meta || {}
    };
  } catch (error) {
    console.error('Error fetching cars:', error);
    return { success: false, results: [], meta: {} };
  }
}

export async function getFilterOptions(): Promise<{ oems: string[]; cities: string[]; bodyTypes: string[]; fuelTypes: string[] }> {
    const oemsSql = 'SELECT DISTINCT oem FROM used_cars ORDER BY oem ASC';
    const citiesSql = 'SELECT DISTINCT city FROM used_cars ORDER BY city ASC';
    const bodyTypesSql = 'SELECT DISTINCT body_type FROM used_cars WHERE body_type IS NOT NULL AND body_type != "" ORDER BY body_type ASC';
    const fuelTypesSql = 'SELECT DISTINCT fuel_type FROM used_cars WHERE fuel_type IS NOT NULL AND fuel_type != "" ORDER BY fuel_type ASC';

    try {
        const [oemsRes, citiesRes, bodyRes, fuelRes] = await Promise.all([
            fetch(QUERY_URL, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: oemsSql, params: [] })
            }),
            fetch(QUERY_URL, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: citiesSql, params: [] })
            }),
            fetch(QUERY_URL, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: bodyTypesSql, params: [] })
            }),
            fetch(QUERY_URL, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: fuelTypesSql, params: [] })
            })
        ]);

        if (!oemsRes.ok || !citiesRes.ok || !bodyRes.ok || !fuelRes.ok) {
            console.error('Failed to fetch filter options');
            return { oems: [], cities: [], bodyTypes: [], fuelTypes: [] };
        }

        const oemsData = await oemsRes.json();
        const citiesData = await citiesRes.json();
        const bodyData = await bodyRes.json();
        const fuelData = await fuelRes.json();

        return {
            oems: (oemsData.results || []).map((r: any) => r.oem).filter(Boolean),
            cities: (citiesData.results || []).map((r: any) => r.city).filter(Boolean),
            bodyTypes: (bodyData.results || []).map((r: any) => r.body_type).filter(Boolean),
            fuelTypes: (fuelData.results || []).map((r: any) => r.fuel_type).filter(Boolean)
        };
    } catch (e) {
        console.error('Error fetching filter options:', e);
        return { oems: [], cities: [], bodyTypes: [], fuelTypes: [] };
    }
}

export async function getCarDetails(used_car_id: number): Promise<UsedCar | null> {
    // Fetch car and all its images
    const sql = `
        SELECT c.*, i.image_url
        FROM used_cars c
        LEFT JOIN car_images i ON c.used_car_id = i.used_car_id
        WHERE c.used_car_id = ?
        ORDER BY i.is_primary DESC, i.image_order ASC
    `;

    try {
        const response = await fetch(QUERY_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query: sql, params: [used_car_id] })
        });

        if (!response.ok) return null;
        
        const data = await response.json();
        const rows = data.results || [];
        if (rows.length === 0) return null;

        // Combine rows into one object with images array
        const car = { ...rows[0], images: [] as string[] };
        // We might get multiple rows for the same car, each with a different image_url
        // BUT the columns from 'c.*' are repeated.
        
        const images = new Set<string>();
        for (const row of rows) {
            if (row.image_url) {
                images.add(row.image_url);
            }
        }
        car.images = Array.from(images);
        delete car.image_url; // Remove the single image_url field from the base object to avoid confusion

        return car;
    } catch (e) {
        console.error('Error fetching car details:', e);
        return null;
    }
}

export function generateCarSlug(car: UsedCar): string {
  // Pattern: make-model-year-city-id
  // e.g. kia-sonet-2024-rajkot-365
  const parts = [
    car.oem,
    car.model,
    car.myear.toString(),
    car.city,
    car.id.toString()
  ];
  return slugify(parts.join(' '));
}

