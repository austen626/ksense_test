// API Key
const API_KEY = "ak_84fd6c13e6b3119ef3cb24f9cfca97df8fd33599aabdc881";

// Function to simulate API fetch with retry logic
async function fetchPatients(page = 1, limit = 5, retries = 10, delay = 1000) {
  try {
    const response = await fetch(`https://assessment.ksensetech.com/api/patients?page=${page}&limit=${limit}`, {
      method: 'GET',
      headers: {
        'x-api-key': API_KEY
      }
    });

    // Check for non-200 status codes
    if (!response.ok) {
      throw { status: response.status, message: response.statusText };
    }

    const data = await response.json();
    const normalizedData = {
      data: data.patients || data.data || [], // Handle both 'patients' and 'data' keys
      pagination: {
        page: data.current_page || data.pagination?.page || 1,
        limit: data.per_page || data.pagination?.limit || limit,
        total: data.total_records || data.pagination?.total || 0,
        totalPages: data.total_records && data.per_page
          ? Math.ceil(data.total_records / data.per_page)
          : data.pagination?.totalPages || 0,
        hasNext: (data.current_page && data.total_records && data.per_page)
          ? data.current_page < Math.ceil(data.total_records / data.per_page)
          : data.pagination?.hasNext || false,
        hasPrevious: (data.current_page && data.current_page > 1) || data.pagination?.hasPrevious || false
      },
      metadata: data.metadata || {
        timestamp: new Date().toISOString(),
        version: data.version || "v1.0",
        requestId: data.requestId || "unknown"
      }
    };

    return normalizedData;
  } catch (error) {
    if ([429, 500, 503].includes(error.status) && retries > 0) {
      console.log(`Error ${error.status} on page ${page}. Retrying after ${delay}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchPatients(page, limit, retries - 1, delay * 2);
    }
    throw error;
  }
}

// Function to parse blood pressure and calculate BP risk score
function calculateBPRisk(bloodPressure) {
  if (!bloodPressure || typeof bloodPressure !== "string" || !/^\d+\/\d+$/.test(bloodPressure)) {
    return -1; // Invalid or missing BP
  }

  const [systolic, diastolic] = bloodPressure.split("/").map(Number);
  if (isNaN(systolic) || isNaN(diastolic)) {
    return -1; // Non-numeric values
  }

  if (systolic >= 140 || diastolic >= 90) return 3; // Stage 2
  if (systolic >= 130 || diastolic >= 80) return 2; // Stage 1
  if (systolic >= 120 && diastolic < 80) return 1; // Elevated
  if (systolic < 120 && diastolic < 80) return 0; // Normal
  return 0; // Fallback for any other case
}

// Function to calculate temperature risk score
function calculateTempRisk(temperature) {
  if (typeof temperature !== "number" || isNaN(temperature) || temperature === null) {
    return -1; // Invalid or missing temperature
  }

  if (temperature >= 101.0) return 2; // High Fever
  if (temperature >= 99.6) return 1; // Low Fever
  return 0; // Normal
}

// Function to calculate age risk score
function calculateAgeRisk(age) {
  if (typeof age !== "number" || isNaN(age) || age === null) {
    return -1; // Invalid or missing age
  }

  if (age > 65) return 2;
  if (age >= 40) return 1;
  return 0;
}

// Function to process patient data and calculate risk scores
function processPatients(patients) {
  const highRiskPatients = [];
  const feverPatients = [];
  const dataQualityIssues = [];

  for (const patient of patients) {
    const { patient_id, blood_pressure, temperature, age } = patient;

    // Calculate individual risk scores
    const bpScore = calculateBPRisk(blood_pressure);
    const tempScore = calculateTempRisk(temperature);
    const ageScore = calculateAgeRisk(age);

    // Check for data quality issues
    const hasInvalidBP = bpScore === -1;
    const hasInvalidTemp = tempScore === -1;
    const hasInvalidAge = ageScore === -1;

    if (hasInvalidBP || hasInvalidTemp || hasInvalidAge) {
      dataQualityIssues.push(patient_id);
    }

    // Calculate total risk score
    const totalRisk = Math.max(bpScore, 0) + Math.max(tempScore, 0) + Math.max(ageScore, 0);

    // Check for high-risk patients (total risk score ≥ 4)
    if (totalRisk >= 4) {
      highRiskPatients.push(patient_id);
    }

    // Check for fever patients (temperature ≥ 99.6°F)
    if (tempScore > 0) {
      feverPatients.push(patient_id);
    }
  }

  return { highRiskPatients, feverPatients, dataQualityIssues };
}

// Main function to fetch all patients and process results
async function main() {
  const allPatients = [];
  let page = 1;
  const limit = 5;
  let hasNext = true;

  // Fetch all pages of patient data
  while (hasNext) {
    try {
      const response = await fetchPatients(page, limit);
      allPatients.push(...response.data);
      hasNext = response.pagination.hasNext;
      page++;
    } catch (error) {
      console.error(`Failed to fetch page ${page}:`, error.message);
      throw `Failed to fetch page ${page}`;
    }
  }

  // Process all patients
  const { highRiskPatients, feverPatients, dataQualityIssues } = processPatients(allPatients);

  // Prepare submission payload
  const submission = {
    high_risk_patients: highRiskPatients,
    fever_patients: feverPatients,
    data_quality_issues: dataQualityIssues
  };

  console.log("Submission Payload:", JSON.stringify(submission, null, 2));

  // In a real scenario, submit the results to the API
  
  await fetch('https://assessment.ksensetech.com/api/submit-assessment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    },
    body: JSON.stringify(submission)
  })
  .then(response => response.json())
  .then(data => {
    console.log('Assessment Results:', data);
  })
  .catch(error => {
    console.error('Submission failed:', error);
  });
  

  return submission;
}
