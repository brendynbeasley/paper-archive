"""Which phrases count everywhere, and which only in an area's own journals.

Some words settle a paper's topic wherever it was published ('monopsony', 'cointegration').
Others only mean something in context: 'england' marks an economic-history paper in the
Journal of Economic History, but not in the Journal of Finance. Those are "home-only":
they are matched only when the paper's journal belongs to the same area.
"""

# Home-only in every area.
GENERIC = set('''
education and|work and|hours and|search and|experience and|employment of|growth and|growth with|growth in
expectations and|beliefs and|liquidity and|volume and|attention and|incidence of|incidence and|incentives and
stability and|evolution and|location and|rights and|law and|law|title|harm|harms|ownership|safety|damages
trial*|court*|appeal*|suits|dispute|disputes|voting|vote|votes|parties|ideolog*|leader*|institutions
institutional|institution|north|reform*|transition|capitalism|capitalist|russia|russian|war|wars|security|peace
military|governance|data|digital|online|web|mobile|computer*|science|scientific|academic|citation*|publication*
diffusion|adoption|standards|team*|employee|career*|management|organization*|organisation*|organisational
communication|coordination|hierarchy|hierarchies|capabilit*|venture|gig|farm|farms|farming|crop*|food|foods|meat
wine|rice|corn|cotton|maize|wheat|energy|oil|fuel|water|carbon|climate|temperature|adaptation|mitigation|waste
noise|transition*|resilience|ecological|soil|marine|wind|solar|coal|nuclear|grid|transmission|heating|crude
pollution|polluting|emissions|environmental|valuing|value of|valuation of|cities|city|housing|rental|rents
construction|moving|density|proximity|dense|regions|regional|county|counties|transport|transportation|road*
roads|rail|bus|buses|trip*|driving|drivers|accidents|shipping|ports|freight|aviation|airline*|infrastructure
traffic|parking|aid|imf|shocks|india|china|africa|village*|targeting|evaluating|evaluation of|impacts of
impact of a|randomization|factory|factories|apparel|mobility|opportunity|status|rank|merit|equality|luxury
needs|unequal|pareto|polarization|distributional|taxation|transfers|in kind|discounting|salience|kink*|notch*
withholding|evasion|offshore|territorial|repatriation|threshold|nice|hui|chip|weight|exercise|substance
survival|gradient|utilization|premium*|depression|gp*|schooling|training|twins|jobs|employment|wages|leisure
retirement|turnover|sorting|recall|quits|women|female|gender|race|racial|ethnic|minorit*|beauty|names|skin
natives|union*|workplace|personnel|insider*|school|schools|teaching|reading|exam*|college|faculty|tenure|stem
iq|intelligence|childhood|boys|girls|sibling*|provider*|specialist*|referral*|patient*|clinical|surgery|ami
mortality|aging|ageing|elderly|disability|longevity|health care|healthcare|medical care|generic*|pharmac*
medicines|vaccine*|biotech*|1918|sanitation|tax rate*|excise*|pension*|old age|unfunded|survivor*|redistribution
municipal*|decentralization|decentralisation|federalism|centralization|devolution|secession|jurisdiction*
inequality|poverty|poor|the poor|the rich|wealthy|intergenerational|generations|fertility|births|marriage
divorce|couples|marital|mating|husband*|wife|wives|spous*|mothers|fathers|feminist|feminism|widow*
developing countries|economic development|latin america|south asia|east asia|sub saharan africa|irrigation
fertilizer|peasant*|subsistence|agrarian|repayment|vulnerability|drought*|floods|rainfall|nutrition|calorie*
donor*|ngo*|world bank|remittance*|garment|upgrading|localization|clusters|amenit*|commuting|urbanization
urbanisation|suburb*|downtown|metropolitan|mortgage*|real estate|homeowners|landlord*|tenant*|renters|zoning
segregation|neighborhood*|neighbourhood*|enclave*|highway*|railroad*|railway*|airport*|subway*|vehicle*
automobile*|tolls|logistics|accessibility|abatement|so2|co2|ghg|warming|hedonic|wtp|wta|recreation
recreational|landscape|scenic|fishing|fishery|fisheries|forest*|forestry|timber|conservation|commons|mineral*
mining|harvest*|catch|ocean*|rotation|species|endangered|habitat|invasive|pest*|rangeland*|hunting|scarcity
electricity|gasoline|opec|renewable*|ethanol|appliance*|petroleum|refin*|pipelines|shale|smog|haze|ozone
toxic*|pollutant*|nitrogen|sulfur|mercury|arsenic|contamination|contaminated|hazardous|chemical*|recycling
plastic|garbage|sustainab*|ecosystem*|biosphere|entropy|decoupling|coevolution|agricultur*|farmer*|yield*
acreage|seed*|livestock|dairy|cattle|hog*|poultry|soybean*|tractor*|mechanization|cooperatives|farmland
quota*|decoupl*|agribusiness|hunger|diet*|dietary|nutrient*|nutritional|beef|pork|chicken|milk|eggs|grocery
restaurant*|beverage*|supermarket*|wetland*|nitrate*|biomass|bioenergy|grassland*|franchis*|contracting
cooperative*|partnership*|mutual*|relational|bonus*|promotion*|recruitment|retention|recognition|awards
feedback|targets|gaming|salaries|coworker*|teamwork|morale|boss*|supervisor*|supervision|authority|delegation
leadership|routines|competence*|lean|layers|headquarters|bureaucracy|entrepreneur*|entrepreneurial
entrepreneurship|founding|nascent|freelanc*|ecosystem*|entrants|turbulence|churning|lognormal|innovation
innovat*|invention*|inventor*|licensing|imitation|patenting|appropriation|ipr|disruptive|compatibility
standardization|latecomer*|leapfrogging|aircraft|steel|semiconductor*|dynamo|scientist*|engineers|laborator*
priority|tacit|codified|bibliometric*|internet|software|privacy|electronic|telecom*|telecommunications
cellular|smartphone*|apps|piracy|algorithmic|personalization|recommender|chatbot*|generative|wikipedia
election*|electoral|turnout|candidate*|incumben*|campaign*|politician*|legislat*|congress*|parliament*
ballot*|partisan*|constitutions|veto|senator*|mayors|governors|presidential|downs|lobby*|rents|capture
committee*|bureaucra*|olson|buchanan|tullock|encompassing|crony|cronyism|populis*|opportunistic|cabinet*
persistence of|origins of|legacy of|legacies|long shadow|settler*|colonialism|extractive|democra*|dictator*
autocra*|authoritarian*|revolution*|coup*|elite*|oligarch*|repression|propaganda|censorship|protest*|suffrage
monarch*|ruler*|tyrann*|aristocra*|succession|surveillance|conflict|violence|terrorism|terror*|insurgency
arms|defense|defence|sanctions|anarchy|predation|appropriation|rebel*|rebellion|conscription|draft|veterans
soldiers|combat|bombing|destruction|alliances|nato|genocide|riots|warfare|corrupt|corrupt*|graft|patronage
nepotism|extortion|illicit|socialism|socialist|soviet|privatization|privatisation|communis*|liberalization
liberalisation|vietnam|cuba|yugoslav*|coase|coasean|posner|calabresi|nuisance|takings|entitlement*|easement*
tort*|liability|liable|negligence|accident*|victim*|injur*|injurer*|precaution|malpractice|warnings|recalls
causation|breach|remedies|reliance|warranties|warranty|creditor*|arbitration|bankruptcy|insolvency|duress
mistake|crime|crimes|criminal*|deterrence|punishment|police|policing|prison*|incarceration|sentenc*
recidivism|fines|illegal|gun*|homicide*|juvenile|gang*|mafia|fraud|offender*|offense*|arrest*|imprisonment
inmates|jail|parole|probation|conviction*|felon*|murder*|robbery|burglary|theft|assault|smuggling
trafficking|prostitution|detection|enforcement|penalt*|firearm*|cops|bail|reentry|litigation|settlement
judge*|judicial|judiciary|jury|juries|pretrial|discovery|lawyer*|attorney*|precedent|prosecutor*|plaintiff*
defendant*|lawsuit*|litigate|litigant*|frivolous|adjudication|mediation|regulation|regulatory|deregulation
regulat*|regulators|regulating|compliance|rulemaking|inspection*|yardstick|adverse possession|anticommons
'''.replace('\n', '|').split('|'))
GENERIC.discard('')

# In these areas a phrase counts everywhere only if it is listed here; all the rest are home-only.
CORE_ONLY = {
 'history': set('''
industrial revolution|great divergence|british industriali*|pre industrial|preindustrial|early modern
medieval|middle ages|black death|european marriage pattern|industrious revolution|little divergence
proto industr*|feudal*|serfdom|guild*|antebellum|colonial america|slavery|slave*|plantation*|postbellum
gilded age|progressive era|jim crow|great migration|age of mass migration|dust bowl|homestead|great depression
depression of the 1930s|interwar|1930s|golden fetters|new deal|great contraction|reparations|weimar|nazi
marshall plan|smoot hawley|gold standard|bimetallism|financial revolution|tulip mania|south sea bubble
mississippi bubble|classical gold standard|wildcat banking|free banking|national banking|anthropometric*
stature|biological standard of living|historical demography|numeracy|age heaping|welfare ratio*|poor law*
poor relief|famine*|plague|east india compan*|atlantic trade|atlantic econom*|mercantil*|first globalization
first era of globalization|nineteenth century globalization|silk road|maghribi|hanse*|champagne fairs|corn laws
cliometric*|new economic history|economic history|glorious revolution|constitutions and commitment
fiscal state|social savings|business history|eighteenth century|18th century|seventeenth century
sixteenth century|fifteenth century|fourteenth century|thirteenth century|nineteenth century|19th century
tudor|victorian|habsburg|ottoman|qing|ming|tokugawa|meiji|mughal|world war i|world war ii|first world war
second world war|railroads and american|american economic history|confedera*|emancipation|enclosure*
historical national accounts|slave trade|friedman and schwartz|stock market crash|great crash|panic of
british empire|colonial india|scramble for africa|second industrial revolution|reconstruction|rise of the west
rise of europe|commercial revolution|price revolution|bank of england|latin monetary union|gerschenkron
'''.replace('\n', '|').split('|')),
 'thought': set('''
adam smith|wealth of nations|ricardo|malthus|john stuart mill|classical political economy|classical economics
physiocra*|quesnay|mercantilis*|say s law|labor theory of value|labour theory of value|marx|marxian|marxist
surplus value|invisible hand|moral sentiments|scottish enlightenment|bentham|marginal revolution|marginalis*
jevons|menger|walras|wicksell|bohm bawerk|irving fisher|cowles commission|chicago school|pigou
socialist calculation|keynes|keynesian revolution|post keynesian|kalecki|minsky|kaldor|sraffa
capital controversy|cambridge capital controversy|history of macroeconomics|neoclassical synthesis
endogenous money|modern monetary theory|stock flow consistent|financial instability hypothesis|wage led
profit led|kaleckian|austrian economics|austrian school|hayek|mises|schumpeter|kirzner|spontaneous order
institutionalis*|veblen|heterodox|heterodox economics|feminist economics|polanyi|regulation school
radical political economics|sraffian|neo ricardian|henry george|german historical school|ordoliberal*
methodology of economics|economic methodology|philosophy of economics|positive economics
methodology of positive|realism of assumptions|instrumentalism|popper|lakatos|rhetoric of economics|mccloskey
critical realism|methodological individualism|homo economicus|economics and ethics|economics as a science
performativity|economic imperialism|credibility revolution|p hacking|publication bias
history of economic thought|history of economics|history of economic analysis|economics profession|economists
teaching of economics|economics education|graduate education in economics|women in economics|journal ranking*
superiority of economists|financialization|financiali*ation|neoliberal*|complexity economics
economic sociology|embeddedness|statistical significance|replication|reproducib*|pre analysis plan*
rational choice theory|marxism|marxian economics|keynesian economics|keynesianism|post keynesians
old institutional economics|original institutional economics|mainstream economics|pluralism in economics
economic thought|economic man|transformation problem|falling rate of profit|monopoly capital|mont pelerin
social structure of accumulation|regulation theory|demand led growth|thirlwall|balance of payments constrained
'''.replace('\n', '|').split('|')),
 'culture': set('''
culture|cultural|trust|social capital|ethnic diversity|ethnic fractionalization|ethnolinguistic|family ties
individualism|collectivism|cultural transmission|civic capital|cultural economics|cultural differences
cultural distance|cultural traits|cultural values|cultural change|cultural persistence|cultural origins
cultural biases|cultural beliefs|generalized trust|social trust|interpersonal trust|bowling alone
fractionalization|national identity|nation building|nationalism|amoral familism|hofstede|world values survey
epidemiological approach|inherited trust|caste|clan*|tribe*|tribal|linguistic|ethnicity|superstition*|taboo*
religion|religio*|church*|religiosity|seculari*|islam*|muslim*|protestant*|catholic*|christian*|jewish|jews
judaism|hindu*|buddhis*|clergy|priest*|missionar*|reformation|protestant ethic|spirit of capitalism
economics of religion|religious participation|church attendance|religious beliefs|ramadan|pilgrimage|hajj
sharia|islamic law|islamic finance|islamic banking|madrasa*|monaster*|anti semitism|antisemitism|pogrom*
inquisition|atheis*|media|media bias|media capture|newspaper*|television|radio|journalism|journalist*
media slant|fox news|media coverage|news coverage|news media|mass media|media ownership|media competition
media freedom|press freedom|broadcasting|fake news|misinformation|disinformation|political advertising
social media and|facebook|echo chamber*|filter bubble*|persuasion|slant|celebrity|museum*|performing arts
cultural good*|cultural industr*|creative industr*|motion picture*|movie*|art auction*|art price*|art market*
cultural heritage|orchestra*|superstar*|sport*|football|baseball|basketball|soccer|olympic*
competitive balance|stadium*|athlete*|paintings|painters|art investment|box office|hollywood|cinema
musicians|gambling|lotter*|casino*|betting|salary cap*|free agency|world cup|mega events|music|film*|artist*
theatre|theater|opera|concert*|festival*
'''.replace('\n', '|').split('|')),
}
for _k in CORE_ONLY:
    CORE_ONLY[_k].discard('')

# Words that looked generic but do settle a topic on their own: keep them everywhere.
GENERIC -= set('''
inequality|poverty|the poor|fertility|marriage|divorce|crime|crimes|criminal*|violence|terrorism|democra*
dictator*|autocra*|authoritarian*|election*|electoral|turnout|politician*|legislat*|congress*|parliament*
partisan*|lobby*|populis*|innovation|innovat*|entrepreneur*|entrepreneurial|entrepreneurship|pension*|housing
mortality|tort*|litigation|lawsuit*|jury|juries|judge*|judicial|lawyer*|attorney*|plaintiff*|defendant*
prosecutor*|regulation|regulatory|deregulation|internet|electricity|privatization|privatisation|sustainab*
agricultur*|women|gender|school|schools|college|wages|schooling|retirement|mortgage*|segregation|police
policing|prison*|incarceration|recidivism|homicide*|juvenile|gang*|mafia|murder*|robbery|burglary|theft
firearm*|gun*|cities|energy|oil|food|pollution|infrastructure|transport|transportation|health care|healthcare
medical care|aging|ageing|elderly|disability|longevity|redistribution|decentralization|decentralisation
federalism|intergenerational|developing countries|economic development|nutrition|irrigation|fertilizer
remittance*|rainfall|drought*|urbanization|urbanisation|commuting|zoning|neighborhood*|neighbourhood*
highway*|railroad*|railway*|airport*|automobile*|vehicle*|real estate|abatement|co2|recreation|fishery
fisheries|fishing|forest*|forestry|timber|conservation|gasoline|opec|renewable*|ethanol|petroleum|recycling
farmer*|livestock|dairy|cattle|farmland|crop*|hunger|dietary|invention*|inventor*|patenting|licensing
scientist*|software|privacy|telecommunications|telecom*|smartphone*|wikipedia|suffrage|genocide|riots
insurgency|socialism|socialist|soviet|communis*|negligence|malpractice|elite*|oligarch*|propaganda|censorship
racial|ethnic|minorit*|childhood|surgery|imf|training
'''.replace('\n', '|').split('|'))

# More words that mislead outside their own journals.
GENERIC |= set('''
mechanism*|experiment*|laboratory|cooperation|moral*|complexity|naive|mistakes|defaults|testing for|tests for
test for|a test of|measuring|measurement of|identifying|identification|cluster*|kernel|smoothing|scoring
pooled|persistence|realized|jumps|jump*|bounds|mediation|interference|attrition|counterfactual|prediction
predictive|predictor*|computational|algorithm*|higher order|elicitation|questionnaire*|seasonal*|cycles
propagation|amplification|comovement|robustness|disagreement|discretion|commitment|credibility|transparency
collateral|depreciation|saving|savings|thrift|velocity|reserves|cash|payments|clearing|ideas|convergence
cross country|steady state|services|openness|exporters|exporting|importers|importing|sourcing|fragmentation
dollar|currencies|euro|pegged|reversal*|spillovers|beta|momentum|predictable|options|swap*|binomial|treasury
affine|repo|spreads|speculative|sentiment|sentiment*|mood|lottery|benchmark*|indexing|recommendations
endowment*|catastrophe|token*|proxy|founder*|managers|vega|acquisition*|restructuring|deal|raiders|issuance
certification|staging|syndication|rescue*|borrower*|lender*|unsecured|branching|punishment|deterrence
candidate*|incumben*|campaign*|settlement|fraud|regulat*|bankruptcy|hedonic|yield*|toxic*|franchis*|union*
institutions|war|jobs|employment|liberalization|liability|city|climate|poor|race|conflict|identity|giving
envy|rents|capture|evolutionary|darwinis*|habit|habits|radical|critique of|preference*|justice|normative
modelling|modeling|realism|philosophy|philosophical|ethics|rationality|ontology|kuhn|ideology|discourse
narrative*|metaphor*|interpretive|pluralis*|paradigm*|prizes|prize*|races|sabotage|imitation|mutation*
calibrated|bidding|ascending|procurement|spectrum|timber|ebay|unraveling|stationarity|autoregressive
arch|heckman|logit|probit|censored|truncated|poisson|selectivity|bayesian|posterior|monte carlo
dynamic programming|shrinkage|regularization|out of sample|imputation|recall|nonresponse|inference|estimator*
'''.replace('\n', '|').split('|'))
GENERIC.discard('')

GENERIC.discard('taxation')
for _p in ('history of economic thought', 'economic thought', 'history of economics', 'replication', 'statistical significance'):
    CORE_ONLY['thought'].discard(_p)
