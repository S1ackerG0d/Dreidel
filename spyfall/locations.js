'use strict';

// Each location has a set of roles. In a round, every non-spy player is given
// the location plus one unique role from its list.
module.exports = [
  {
    name: 'Airplane',
    roles: ['Pilot', 'Flight Attendant', 'Air Marshal', 'First Class Passenger', 'Economy Passenger', 'Mechanic', 'Co-Pilot'],
  },
  {
    name: 'Bank',
    roles: ['Manager', 'Teller', 'Security Guard', 'Armored Car Driver', 'Customer', 'Robber', 'Loan Officer'],
  },
  {
    name: 'Beach',
    roles: ['Lifeguard', 'Surfer', 'Tourist', 'Ice Cream Vendor', 'Beach Photographer', 'Kite Surfer', 'Sunbather'],
  },
  {
    name: 'Casino',
    roles: ['Dealer', 'Bouncer', 'Manager', 'Gambler', 'Bartender', 'Hustler', 'Cocktail Server'],
  },
  {
    name: 'Cathedral',
    roles: ['Priest', 'Beggar', 'Sinner', 'Tourist', 'Choir Singer', 'Organist', 'Altar Boy'],
  },
  {
    name: 'Circus Tent',
    roles: ['Acrobat', 'Animal Trainer', 'Magician', 'Fire Eater', 'Clown', 'Juggler', 'Visitor'],
  },
  {
    name: 'Corporate Party',
    roles: ['CEO', 'Manager', 'Accountant', 'Secretary', 'Delivery Boy', 'Unwelcome Guest', 'Entertainer'],
  },
  {
    name: 'Hospital',
    roles: ['Doctor', 'Nurse', 'Surgeon', 'Patient', 'Anesthesiologist', 'Intern', 'Therapist'],
  },
  {
    name: 'Hotel',
    roles: ['Manager', 'Receptionist', 'Bellman', 'Housekeeper', 'Guest', 'Doorman', 'Security Guard'],
  },
  {
    name: 'Military Base',
    roles: ['Colonel', 'Soldier', 'Sniper', 'Medic', 'Tank Driver', 'Spy', 'Engineer'],
  },
  {
    name: 'Movie Studio',
    roles: ['Director', 'Actor', 'Stuntman', 'Cameraman', 'Costume Designer', 'Producer', 'Sound Engineer'],
  },
  {
    name: 'Ocean Liner',
    roles: ['Captain', 'Bartender', 'Musician', 'Rich Passenger', 'Cook', 'Waiter', 'Mechanic'],
  },
  {
    name: 'Passenger Train',
    roles: ['Conductor', 'Engineer', 'Passenger', 'Stoker', 'Restaurant Chef', 'Border Guard', 'Stowaway'],
  },
  {
    name: 'Pirate Ship',
    roles: ['Captain', 'First Mate', 'Cabin Boy', 'Cannoneer', 'Cook', 'Prisoner', 'Lookout'],
  },
  {
    name: 'Police Station',
    roles: ['Detective', 'Patrol Officer', 'Criminal', 'Lawyer', 'Journalist', 'Witness', 'Forensic Analyst'],
  },
  {
    name: 'Restaurant',
    roles: ['Chef', 'Waiter', 'Food Critic', 'Customer', 'Dishwasher', 'Hostess', 'Bartender'],
  },
  {
    name: 'School',
    roles: ['Principal', 'Teacher', 'Student', 'Janitor', 'Cafeteria Cook', 'Gym Coach', 'Librarian'],
  },
  {
    name: 'Space Station',
    roles: ['Commander', 'Astronaut', 'Scientist', 'Engineer', 'Doctor', 'Alien Specimen', 'Tourist'],
  },
  {
    name: 'Submarine',
    roles: ['Captain', 'Sonar Operator', 'Navigator', 'Cook', 'Engineer', 'Radio Operator', 'Sailor'],
  },
  {
    name: 'Supermarket',
    roles: ['Manager', 'Cashier', 'Customer', 'Butcher', 'Security Guard', 'Stock Clerk', 'Janitor'],
  },
  {
    name: 'Theater',
    roles: ['Actor', 'Director', 'Usher', 'Prompter', 'Audience Member', 'Coat Check', 'Stagehand'],
  },
  {
    name: 'University',
    roles: ['Professor', 'Student', 'Dean', 'Janitor', 'Librarian', 'Graduate', 'Security Guard'],
  },
];
